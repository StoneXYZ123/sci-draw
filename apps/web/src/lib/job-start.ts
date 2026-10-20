import { randomBytes } from "node:crypto";
import type { LedgerReason } from "@sci-draw/credits";
import { and, eq } from "drizzle-orm";
import { job } from "@/db/schema";
import { getDb, type Database } from "@/db";
import { confirmCredits, InsufficientCreditsError, reserveCreditsTx, rollbackCredits } from "@/lib/credits";
import { claimJobCompleted, claimJobFailed } from "@/lib/job-claim";
import { IdempotencyConflictError } from "@/lib/idempotency";
import { isUniqueViolation } from "@/lib/pg-error";

type JobRow = typeof job.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbLike = Database | Tx;

const STALE_MS = 6 * 60 * 1000;

function hashOf(request: unknown): string {
  if (typeof request === "object" && request !== null && "inputHash" in request && typeof request.inputHash === "string") {
    return request.inputHash;
  }
  return "";
}

async function findByBatch(db: DbLike, userId: string, batchId: string): Promise<JobRow | undefined> {
  const [row] = await db.select().from(job).where(and(eq(job.userId, userId), eq(job.batchId, batchId))).limit(1);
  return row;
}

function assertSameHash(existing: JobRow, request: Record<string, unknown>): void {
  const next = hashOf(request);
  const previous = hashOf(existing.request);
  if (next && previous && next !== previous) {
    throw new IdempotencyConflictError();
  }
}

export async function beginUserJob(input: {
  userId: string;
  type: string;
  batchId: string;
  request: Record<string, unknown>;
  credits: number;
  reserveReason: LedgerReason;
}): Promise<{ row: JobRow; created: boolean }> {
  const db = getDb();
  const existing = await findByBatch(db, input.userId, input.batchId);
  if (existing) {
    assertSameHash(existing, input.request);
    return { row: existing, created: false };
  }
  const id = randomBytes(32).toString("hex");
  try {
    const created = await db.transaction(async (tx) => {
      const raced = await findByBatch(tx, input.userId, input.batchId);
      if (raced) {
        return raced;
      }
      await reserveCreditsTx(tx, input.userId, input.credits, id, input.reserveReason);
      await tx.insert(job).values({
        id,
        userId: input.userId,
        type: input.type,
        status: "pending",
        request: input.request,
        creditsReserved: input.credits,
        creditsConsumed: 0,
        batchId: input.batchId,
      });
      const [row] = await tx.select().from(job).where(eq(job.id, id)).limit(1);
      if (!row) {
        throw new Error("Job insert failed");
      }
      return row;
    });
    if (created.id !== id) {
      assertSameHash(created, input.request);
      return { row: created, created: false };
    }
    return { row: created, created: true };
  } catch (error) {
    if (error instanceof InsufficientCreditsError || error instanceof IdempotencyConflictError) {
      throw error;
    }
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const raced = await findByBatch(db, input.userId, input.batchId);
    if (!raced) {
      throw error;
    }
    assertSameHash(raced, input.request);
    return { row: raced, created: false };
  }
}

export async function claimRunning(jobId: string, type: string): Promise<JobRow | undefined> {
  const [row] = await getDb()
    .update(job)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(job.id, jobId), eq(job.type, type), eq(job.status, "pending")))
    .returning();
  return row;
}

export async function finishJobSuccess(input: {
  jobId: string;
  userId: string;
  result: unknown;
  creditsConsumed: number;
  consumeReason: LedgerReason;
}): Promise<boolean> {
  const claimed = await claimJobCompleted(input.jobId, {
    result: input.result,
    creditsConsumed: input.creditsConsumed,
  });
  if (!claimed) {
    return false;
  }
  await confirmCredits(input.userId, input.jobId, input.consumeReason);
  return true;
}

export async function finishJobFailure(input: {
  jobId: string;
  cost: number;
  errorCode: string;
  errorMessage: string;
  rollbackReason: LedgerReason;
  result?: unknown;
}): Promise<boolean> {
  const claimed = await claimJobFailed(input.jobId, {
    errorCode: input.errorCode,
    errorMessage: input.errorMessage.slice(0, 300),
    result: input.result,
  });
  if (!claimed) {
    return false;
  }
  await rollbackCredits(claimed.userId, input.cost, claimed.id, input.rollbackReason);
  return true;
}

export function isStaleRunning(row: JobRow): boolean {
  if (row.status !== "running" || !row.updatedAt) {
    return false;
  }
  return Date.now() - row.updatedAt.getTime() >= STALE_MS;
}

export async function readJob(jobId: string): Promise<JobRow | undefined> {
  const [row] = await getDb().select().from(job).where(eq(job.id, jobId)).limit(1);
  return row;
}
