import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it, after } from "node:test";
import { LEDGER_REASONS } from "@sci-draw/credits";
import { eq, inArray, sql } from "drizzle-orm";
import { creditLedger, job, user } from "@/db/schema";
import { getDb } from "@/db";
import { confirmCredits, ensureSignupBonus, getBalance, grantCredits, reserveCreditsTx, rollbackCredits, signupBonusAmount } from "@/lib/credits";
import { claimJobCompleted, claimJobFailed } from "@/lib/job-claim";
import { isUniqueViolation } from "@/lib/pg-error";

const userIds: string[] = [];

function requireDatabase(): void {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for claim tests");
}

async function insertUser(): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await getDb().insert(user).values({
    id,
    name: "Claim test",
    email: `${id}@claim.test`,
    emailVerified: false,
    creditsBalance: 0,
  });
  return id;
}

async function insertJob(userId: string, status: "pending" | "running", creditsReserved: number): Promise<string> {
  const id = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  await getDb().insert(job).values({
    id,
    userId,
    type: "generate",
    status,
    request: { mode: "prompt", prompt: "claim" },
    creditsReserved,
    creditsConsumed: 0,
    batchId: id,
  });
  return id;
}

async function reasonCount(refId: string, reason: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(creditLedger)
    .where(sql`${creditLedger.refId} = ${refId} and ${creditLedger.reason} = ${reason}`);
  return Number(row?.count ?? 0);
}

describe("ledger idempotency and job claims", () => {
  after(async () => {
    if (!process.env.DATABASE_URL || userIds.length === 0) {
      return;
    }
    await getDb().delete(user).where(inArray(user.id, userIds));
  });

  it("recognizes a unique violation on the error or its cause", () => {
    assert.equal(isUniqueViolation({ code: "23505" }), true);
    assert.equal(isUniqueViolation({ cause: { code: "23505" } }), true);
    assert.equal(isUniqueViolation({ code: "23503" }), false);
  });

  it("grants the signup bonus once when two calls race", async () => {
    requireDatabase();
    const userId = await insertUser();
    await Promise.all([ensureSignupBonus(userId), ensureSignupBonus(userId)]);
    await ensureSignupBonus(userId);
    assert.equal(await getBalance(userId), signupBonusAmount());
    assert.equal(await reasonCount(userId, LEDGER_REASONS.signupBonus), 1);
  });

  it("refunds a reserved job once when two rollbacks race", async () => {
    requireDatabase();
    const userId = await insertUser();
    await ensureSignupBonus(userId);
    const jobId = await insertJob(userId, "running", 5);
    await getDb().transaction(async (tx) => {
      await reserveCreditsTx(tx, userId, 5, jobId);
    });
    const afterReserve = await getBalance(userId);
    await Promise.all([rollbackCredits(userId, 5, jobId), rollbackCredits(userId, 5, jobId)]);
    assert.equal(await getBalance(userId), afterReserve + 5);
    assert.equal(await reasonCount(jobId, LEDGER_REASONS.rollback), 1);
  });

  it("does not refund a completed job and does not confirm after a fail claim", async () => {
    requireDatabase();
    const userId = await insertUser();
    await ensureSignupBonus(userId);
    const finished = await insertJob(userId, "running", 5);
    await getDb().update(job).set({ status: "completed" }).where(eq(job.id, finished));
    const missed = await claimJobFailed(finished, { errorCode: "GENERATION_FAILED", errorMessage: "late" });
    assert.equal(missed, undefined);
    assert.equal(await reasonCount(finished, LEDGER_REASONS.rollback), 0);

    const racing = await insertJob(userId, "running", 5);
    await getDb().transaction(async (tx) => {
      await reserveCreditsTx(tx, userId, 5, racing);
    });
    const before = await getBalance(userId);
    const [first, second] = await Promise.all([
      claimJobFailed(racing, { errorCode: "GENERATION_FAILED", errorMessage: "one" }),
      claimJobFailed(racing, { errorCode: "GENERATION_FAILED", errorMessage: "two" }),
    ]);
    const winners = [first, second].filter((row) => row !== undefined);
    assert.equal(winners.length, 1);
    if (winners[0]) {
      await rollbackCredits(winners[0].userId, winners[0].creditsReserved, winners[0].id);
    }
    assert.equal(await getBalance(userId), before + 5);
    assert.equal(await reasonCount(racing, LEDGER_REASONS.rollback), 1);

    const completed = await claimJobCompleted(racing, { result: { success: true }, creditsConsumed: 5 });
    assert.equal(completed, undefined);
    if (completed) {
      await confirmCredits(userId, racing);
    }
    const [status] = await getDb().select({ status: job.status }).from(job).where(eq(job.id, racing)).limit(1);
    assert.equal(status?.status, "failed");
    assert.equal(await reasonCount(racing, LEDGER_REASONS.consume), 0);
  });

  it("confirms only after a running job is claimed completed", async () => {
    requireDatabase();
    const userId = await insertUser();
    await ensureSignupBonus(userId);
    const jobId = await insertJob(userId, "running", 5);
    await getDb().transaction(async (tx) => {
      await reserveCreditsTx(tx, userId, 5, jobId);
    });
    const claimed = await claimJobCompleted(jobId, { result: { success: true }, creditsConsumed: 5 });
    assert.ok(claimed);
    await confirmCredits(userId, jobId);
    await confirmCredits(userId, jobId);
    assert.equal(await reasonCount(jobId, LEDGER_REASONS.consume), 1);
    const late = await claimJobFailed(jobId, { errorCode: "GENERATION_FAILED", errorMessage: "stale" });
    assert.equal(late, undefined);
    const [status] = await getDb().select({ status: job.status }).from(job).where(eq(job.id, jobId)).limit(1);
    assert.equal(status?.status, "completed");
    assert.equal(await reasonCount(jobId, LEDGER_REASONS.rollback), 0);
  });

  it("grants a stripe purchase once for the same session", async () => {
    requireDatabase();
    const userId = await insertUser();
    const sessionId = `cs_test_${randomUUID()}`;
    const [first, second] = await Promise.all([
      grantCredits(userId, 100, LEDGER_REASONS.purchaseStripe, sessionId, "stripe_checkout"),
      grantCredits(userId, 100, LEDGER_REASONS.purchaseStripe, sessionId, "stripe_checkout"),
    ]);
    await grantCredits(userId, 100, LEDGER_REASONS.purchaseStripe, sessionId, "stripe_checkout");
    const applied = [first, second].filter((item) => item === "applied");
    assert.equal(applied.length, 1);
    assert.equal(await getBalance(userId), 100);
    assert.equal(await reasonCount(sessionId, LEDGER_REASONS.purchaseStripe), 1);
  });
});
