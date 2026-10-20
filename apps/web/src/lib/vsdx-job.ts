import { randomBytes } from "node:crypto";
import { convertCredits } from "@sci-draw/credits";
import { convertImageToVsdx, resolveVsdxProviderMode, VsdxUnavailableError } from "@sci-draw/providers";
import { and, eq } from "drizzle-orm";
import { job } from "@/db/schema";
import { getDb } from "@/db";
import { CONVERT_PURPOSE, readReadyUpload, SOURCE_PURPOSE } from "@/lib/uploads";
import { consumeReason, creditFamilyForJob, reserveReason, rollbackReason } from "@/lib/credit-family";
import { ensureSignupBonus } from "@/lib/credits";
import { beginUserJob, claimRunning, finishJobFailure, finishJobSuccess, isStaleRunning, readJob } from "@/lib/job-start";
import { readResultObject, resultKeyForUser, persistUserFile } from "@/lib/storage";

export const VSDX_ERROR = "VSDX export is not available in this release";
export const VSDX_CODE = "NOT_IMPLEMENTED";

const VSDX_MIME = "application/vnd.ms-visio.drawing";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}

function currentVsdxMode() {
  return resolveVsdxProviderMode({
    CONVERT_VSDX_PROVIDER: process.env.CONVERT_VSDX_PROVIDER,
    CLOUDCONVERT_API_KEY: process.env.CLOUDCONVERT_API_KEY,
  });
}

export function vsdxProviderConfigured(): boolean {
  return currentVsdxMode() !== "unavailable";
}

export function vsdxJobCredits(): number {
  const mode = currentVsdxMode();
  switch (mode) {
    case "cloudconvert":
      return convertCredits({ kind: "vsdx" });
    case "mock":
    case "unavailable":
      return 0;
    default: {
      const neverMode: never = mode;
      return neverMode;
    }
  }
}

export async function recordVsdxUnavailable(userId: string, request: unknown) {
  const id = randomBytes(32).toString("hex");
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

async function loadImage(userId: string, request: Record<string, unknown>): Promise<{ bytes: Uint8Array; filename: string }> {
  const filename = typeof request.filename === "string" && request.filename.trim() ? request.filename.trim() : "figure.png";
  if (typeof request.objectKey === "string" && request.objectKey) {
    try {
      const source = await readReadyUpload(userId, request.objectKey, CONVERT_PURPOSE);
      return { bytes: source.bytes, filename };
    } catch {
      const source = await readReadyUpload(userId, request.objectKey, SOURCE_PURPOSE);
      return { bytes: source.bytes, filename };
    }
  }
  if (typeof request.imageUrl === "string" && request.imageUrl) {
    const key = resultKeyForUser(request.imageUrl, userId);
    if (!key) {
      throw new Error("Image was not found");
    }
    const bytes = await readResultObject(key);
    if (!bytes) {
      throw new Error("Image was not found");
    }
    return { bytes, filename };
  }
  throw new Error("imageUrl or objectKey is required");
}

export async function startVsdxJob(input: {
  userId: string;
  request: Record<string, unknown>;
  batchId: string;
}): Promise<{ row: typeof job.$inferSelect; created: boolean }> {
  await ensureSignupBonus(input.userId);
  const family = creditFamilyForJob("convert_vsdx");
  if (family !== "convert") {
    throw new Error("VSDX credit family is missing");
  }
  return beginUserJob({
    userId: input.userId,
    type: "convert_vsdx",
    batchId: input.batchId,
    request: input.request,
    credits: vsdxJobCredits(),
    reserveReason: reserveReason(family),
  });
}

export async function processVsdxJob(jobId: string): Promise<void> {
  // In-process after(), same limit as drawing jobs. CloudConvert polling stays inside this call
  // (about 90s). A separate queue is not wired: one process can finish the provider call, and
  // the credit claim rules stay on this row. Inngest would only matter for multi-instance durability.
  const running = await claimRunning(jobId, "convert_vsdx");
  if (!running) {
    const existing = await readJob(jobId);
    if (existing && isStaleRunning(existing) && existing.type === "convert_vsdx") {
      const family = creditFamilyForJob(existing.type);
      if (family) {
        await finishJobFailure({
          jobId: existing.id,
          cost: existing.creditsReserved,
          errorCode: "JOB_TIMEOUT",
          errorMessage: "VSDX export timed out",
          rollbackReason: rollbackReason(family),
        });
      }
    }
    return;
  }
  const family = creditFamilyForJob("convert_vsdx");
  if (!family) {
    return;
  }
  const cost = running.creditsReserved;
  try {
    const request = asRecord(running.request);
    const image = await loadImage(running.userId, request);
    const bytes = await convertImageToVsdx({
      bytes: image.bytes,
      filename: image.filename,
      env: {
        CONVERT_VSDX_PROVIDER: process.env.CONVERT_VSDX_PROVIDER,
        CLOUDCONVERT_API_KEY: process.env.CLOUDCONVERT_API_KEY,
      },
    });
    const stored = await persistUserFile({
      userId: running.userId,
      bytes,
      mimeType: VSDX_MIME,
      extension: "vsdx",
    });
    await finishJobSuccess({
      jobId: running.id,
      userId: running.userId,
      creditsConsumed: cost,
      consumeReason: consumeReason(family),
      result: {
        vsdxUrl: stored.url,
        creditsConsumed: cost,
        files: [{ url: stored.url, format: "vsdx" }],
      },
    });
  } catch (error) {
    const unavailable = error instanceof VsdxUnavailableError;
    await finishJobFailure({
      jobId: running.id,
      cost,
      errorCode: unavailable ? VSDX_CODE : "VSDX_FAILED",
      errorMessage: unavailable ? VSDX_ERROR : error instanceof Error ? error.message : "VSDX export failed",
      rollbackReason: rollbackReason(family),
    });
  }
}

export async function readVsdxJob(userId: string, jobId: string) {
  const [row] = await getDb()
    .select()
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.userId, userId), eq(job.type, "convert_vsdx")))
    .limit(1);
  if (!row) {
    return null;
  }
  if (isStaleRunning(row)) {
    await processVsdxJob(row.id);
    return readVsdxJob(userId, jobId);
  }
  const result = asRecord(row.result);
  const vsdxUrl = typeof result.vsdxUrl === "string" ? result.vsdxUrl : undefined;
  return {
    jobId: row.id,
    status: row.status,
    ...(row.errorCode ? { errorCode: row.errorCode, error: row.errorMessage ?? VSDX_ERROR } : {}),
    ...(vsdxUrl ? { vsdxUrl, creditsConsumed: row.creditsConsumed } : {}),
  };
}
