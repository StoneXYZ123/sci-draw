import { randomUUID } from "node:crypto";
import { LEDGER_REASONS, type LedgerReason } from "@sci-draw/credits";
import { and, desc, eq } from "drizzle-orm";
import { creditLedger, user } from "@/db/schema";
import { getDb, type Database } from "@/db";
import { isUniqueViolation } from "@/lib/pg-error";

export class InsufficientCreditsError extends Error {
  readonly errorCode = "INSUFFICIENT_CREDITS" as const;

  constructor() {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}

export function signupBonusAmount(): number {
  const raw = Number(process.env.CREDITS_SIGNUP_BONUS ?? "20");
  if (!Number.isFinite(raw) || raw < 0) {
    return 20;
  }
  return Math.floor(raw);
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function appendLedger(
  tx: Tx,
  input: {
    userId: string;
    delta: number;
    reason: LedgerReason;
    refType?: string;
    refId?: string;
  },
): Promise<number> {
  const [locked] = await tx.select().from(user).where(eq(user.id, input.userId)).for("update");
  if (!locked) {
    throw new Error("User not found");
  }
  const balanceAfter = locked.creditsBalance + input.delta;
  if (balanceAfter < 0) {
    throw new InsufficientCreditsError();
  }
  await tx.update(user).set({ creditsBalance: balanceAfter, updatedAt: new Date() }).where(eq(user.id, input.userId));
  await tx.insert(creditLedger).values({
    id: randomUUID(),
    userId: input.userId,
    delta: input.delta,
    reason: input.reason,
    refType: input.refType,
    refId: input.refId,
    balanceAfter,
  });
  return balanceAfter;
}

async function ignoreUniqueConflict(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }
}

export async function ensureSignupBonus(userId: string): Promise<void> {
  const db = getDb();
  await ignoreUniqueConflict(() =>
    db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(and(eq(creditLedger.userId, userId), eq(creditLedger.reason, LEDGER_REASONS.signupBonus)))
        .limit(1);
      if (existing) {
        return;
      }
      await appendLedger(tx, {
        userId,
        delta: signupBonusAmount(),
        reason: LEDGER_REASONS.signupBonus,
        refType: "user",
        refId: userId,
      });
    }),
  );
}

export type DbTransaction = Tx;

export async function reserveCreditsTx(
  tx: DbTransaction,
  userId: string,
  cost: number,
  jobId: string,
  reason: LedgerReason = LEDGER_REASONS.reserve,
): Promise<number> {
  return appendLedger(tx, {
    userId,
    delta: -cost,
    reason,
    refType: "job",
    refId: jobId,
  });
}

export async function confirmCredits(userId: string, jobId: string, reason: LedgerReason = LEDGER_REASONS.consume): Promise<void> {
  const db = getDb();
  await ignoreUniqueConflict(() =>
    db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(and(eq(creditLedger.refId, jobId), eq(creditLedger.reason, reason)))
        .limit(1);
      if (existing) {
        return;
      }
      await appendLedger(tx, {
        userId,
        delta: 0,
        reason,
        refType: "job",
        refId: jobId,
      });
    }),
  );
}

export async function rollbackCredits(
  userId: string,
  cost: number,
  jobId: string,
  reason: LedgerReason = LEDGER_REASONS.rollback,
): Promise<void> {
  if (cost <= 0) {
    return;
  }
  const db = getDb();
  await ignoreUniqueConflict(() =>
    db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(and(eq(creditLedger.refId, jobId), eq(creditLedger.reason, reason)))
        .limit(1);
      if (existing) {
        return;
      }
      await appendLedger(tx, {
        userId,
        delta: cost,
        reason,
        refType: "job",
        refId: jobId,
      });
    }),
  );
}

export async function grantCredits(
  userId: string,
  amount: number,
  reason: LedgerReason,
  refId: string,
  refType: string,
): Promise<"applied" | "duplicate"> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Credit grant must be a positive integer");
  }
  if (!refId) {
    throw new Error("Credit grant needs a ref id");
  }
  try {
    let outcome: "applied" | "duplicate" = "applied";
    await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(and(eq(creditLedger.refId, refId), eq(creditLedger.reason, reason)))
        .limit(1);
      if (existing) {
        outcome = "duplicate";
        return;
      }
      await appendLedger(tx, {
        userId,
        delta: amount,
        reason,
        refType,
        refId,
      });
    });
    return outcome;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return "duplicate";
    }
    throw error;
  }
}

export async function getBalance(userId: string): Promise<number> {
  const [row] = await getDb().select({ creditsBalance: user.creditsBalance }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.creditsBalance ?? 0;
}

export async function listLedger(userId: string, limit = 20) {
  return getDb()
    .select({
      id: creditLedger.id,
      delta: creditLedger.delta,
      reason: creditLedger.reason,
      refType: creditLedger.refType,
      refId: creditLedger.refId,
      balanceAfter: creditLedger.balanceAfter,
      createdAt: creditLedger.createdAt,
    })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit);
}
