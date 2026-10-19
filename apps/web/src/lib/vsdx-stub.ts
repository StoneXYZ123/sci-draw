import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { job } from "@/db/schema";
import { getDb } from "@/db";

export const VSDX_ERROR = "VSDX export is not available in this release";
export const VSDX_CODE = "NOT_IMPLEMENTED";

function taskId(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

export async function recordVsdxStub(userId: string, request: unknown) {
  const id = taskId();
  const result = { success: false, errorCode: VSDX_CODE, error: VSDX_ERROR };
  await getDb().insert(job).values({
    id,
    userId,
    type: "convert_vsdx",
    status: "failed",
    request,
    result,
    errorCode: VSDX_CODE,
    errorMessage: VSDX_ERROR,
    creditsReserved: 0,
    creditsConsumed: 0,
    batchId: `vsdx-${id}`,
    completedAt: new Date(),
  });
  return { jobId: id, status: "failed" as const, errorCode: VSDX_CODE, error: VSDX_ERROR };
}

export async function readVsdxStub(userId: string, jobId: string) {
  const [row] = await getDb()
    .select()
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.userId, userId), eq(job.type, "convert_vsdx")))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    jobId: row.id,
    status: row.status,
    errorCode: row.errorCode ?? VSDX_CODE,
    error: row.errorMessage ?? VSDX_ERROR,
  };
}
