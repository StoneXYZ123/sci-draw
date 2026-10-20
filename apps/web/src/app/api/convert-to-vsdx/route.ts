import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { jsonNoStore } from "@/lib/http";
import { IdempotencyConflictError, IdempotencyKeyError, readIdempotencyKey, requestHash, scopedBatchId } from "@/lib/idempotency";
import { InsufficientCreditsError } from "@/lib/credits";
import { getSessionUser } from "@/lib/session";
import { processVsdxJob, readVsdxJob, recordVsdxUnavailable, startVsdxJob, VSDX_CODE, VSDX_ERROR, vsdxProviderConfigured } from "@/lib/vsdx-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  imageUrl: z.string().trim().url().max(2000).optional(),
  objectKey: z.string().trim().min(1).max(512).optional(),
  filename: z.string().trim().max(180).optional(),
  messageId: z.string().trim().max(128).optional(),
  conversationId: z.string().trim().max(128).optional(),
});

const JOB_ID = /^[a-f0-9]{64}$/;

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  let payload: unknown = {};
  if (request.headers.get("content-length") !== "0") {
    try {
      payload = await request.json();
    } catch {
      return jsonNoStore({ error: "Invalid request" }, 400);
    }
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return jsonNoStore({ error: "Invalid request" }, 400);
  }
  if (!vsdxProviderConfigured()) {
    const recorded = await recordVsdxUnavailable(sessionUser.id, parsed.data);
    return jsonNoStore(recorded, 202);
  }
  if (!parsed.data.imageUrl && !parsed.data.objectKey) {
    return jsonNoStore({ error: "imageUrl or objectKey is required" }, 400);
  }
  try {
    const idempotencyKey = readIdempotencyKey(request);
    const batchId = idempotencyKey
      ? scopedBatchId("vsdx", sessionUser.id, idempotencyKey)
      : `vsdx-${randomBytes(16).toString("hex")}`;
    const started = await startVsdxJob({
      userId: sessionUser.id,
      batchId,
      request: {
        ...parsed.data,
        inputHash: requestHash([parsed.data.imageUrl, parsed.data.objectKey, parsed.data.filename]),
      },
    });
    if (started.created && started.row.status === "pending") {
      after(() => processVsdxJob(started.row.id));
    } else if (started.row.status === "pending") {
      after(() => processVsdxJob(started.row.id));
    }
    const view = await readVsdxJob(sessionUser.id, started.row.id);
    return jsonNoStore(view ?? { jobId: started.row.id, status: started.row.status }, 202);
  } catch (error) {
    if (error instanceof IdempotencyKeyError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 400);
    }
    if (error instanceof IdempotencyConflictError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 409);
    }
    if (error instanceof InsufficientCreditsError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 402);
    }
    console.error("vsdx start failed", error instanceof Error ? error.message : "unknown");
    return jsonNoStore({ error: VSDX_ERROR, errorCode: VSDX_CODE }, 500);
  }
}

export async function GET(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
  if (!JOB_ID.test(jobId)) {
    return jsonNoStore({ error: "Not found" }, 404);
  }
  const row = await readVsdxJob(sessionUser.id, jobId);
  if (!row) {
    return jsonNoStore({ error: "Not found" }, 404);
  }
  if (row.status === "pending") {
    after(() => processVsdxJob(row.jobId));
  }
  return jsonNoStore(row);
}
