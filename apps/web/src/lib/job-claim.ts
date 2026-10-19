import { and, eq, inArray } from "drizzle-orm";
import { job } from "@/db/schema";
import { getDb } from "@/db";

type JobRow = typeof job.$inferSelect;

export type JobFailClaim = {
  errorCode: string;
  errorMessage: string;
  result?: unknown;
};

export async function claimJobFailed(jobId: string, claim: JobFailClaim): Promise<JobRow | undefined> {
  const now = new Date();
  const [row] = await getDb()
    .update(job)
    .set({
      status: "failed",
      ...(claim.result !== undefined ? { result: claim.result } : {}),
      errorCode: claim.errorCode,
      errorMessage: claim.errorMessage,
      creditsConsumed: 0,
      updatedAt: now,
      completedAt: now,
    })
    .where(and(eq(job.id, jobId), inArray(job.status, ["pending", "running"])))
    .returning();
  return row;
}

export async function claimJobCompleted(
  jobId: string,
  patch: { result: unknown; creditsConsumed: number; completedAt?: Date },
): Promise<JobRow | undefined> {
  const now = patch.completedAt ?? new Date();
  const [row] = await getDb()
    .update(job)
    .set({
      status: "completed",
      result: patch.result,
      creditsConsumed: patch.creditsConsumed,
      updatedAt: now,
      completedAt: now,
    })
    .where(and(eq(job.id, jobId), eq(job.status, "running")))
    .returning();
  return row;
}
