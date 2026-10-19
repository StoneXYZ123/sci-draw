import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { uploadObject } from "@/db/schema";
import { getDb } from "@/db";
import {
  appUrl,
  deletePrivateObject,
  isR2Configured,
  isUploadObjectKey,
  presignSourcePut,
  readPrivateObject,
  writePrivateObject,
} from "@/lib/storage";

export const SOURCE_PURPOSE = "ai-drawing-source";
export const CONVERT_PURPOSE = "convert-source";
export const SCIVIS_PURPOSE = "sci-vis-data";
export const UPLOAD_PURPOSES = [SOURCE_PURPOSE, CONVERT_PURPOSE, SCIVIS_PURPOSE] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export function isUploadPurpose(value: string): value is UploadPurpose {
  return value === SOURCE_PURPOSE || value === CONVERT_PURPOSE || value === SCIVIS_PURPOSE;
}
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const UPLOAD_TTL_MS = 10 * 60 * 1000;

const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
} as const;

const DATA_TYPES = {
  "text/csv": "csv",
  "application/csv": "csv",
  "text/tab-separated-values": "tsv",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
} as const;

export class UploadRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UploadRequestError";
  }
}

function extensionFor(purpose: UploadPurpose, contentType: string): string | null {
  if (purpose === SCIVIS_PURPOSE) {
    if (
      contentType === "text/csv" ||
      contentType === "application/csv" ||
      contentType === "text/tab-separated-values" ||
      contentType === "text/plain" ||
      contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      contentType === "application/vnd.ms-excel"
    ) {
      return DATA_TYPES[contentType];
    }
    return null;
  }
  if (contentType === "image/png" || contentType === "image/jpeg" || contentType === "image/webp") {
    return IMAGE_TYPES[contentType];
  }
  return null;
}

function sizeMessage(purpose: UploadPurpose): string {
  return purpose === SCIVIS_PURPOSE ? "File must be 5 MB or smaller" : "Image must be 5 MB or smaller";
}

function typeMessage(purpose: UploadPurpose): string {
  return purpose === SCIVIS_PURPOSE ? "Use a CSV, TSV, TXT, XLSX, or XLS file" : "Use a PNG, JPEG, or WebP image";
}

function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "source";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 120);
  return cleaned || "source";
}

function userIdSegment(userId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) {
    throw new UploadRequestError("Account id cannot own an upload", 400);
  }
  return userId;
}

function signature(objectKey: string, exp: number, contentType: string): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  return createHmac("sha256", secret).update(`${objectKey}\n${exp}\n${contentType}`).digest("hex");
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function localUploadUrl(objectKey: string, contentType: string): string {
  const exp = Date.now() + UPLOAD_TTL_MS;
  const params = new URLSearchParams({
    key: objectKey,
    exp: String(exp),
    sig: signature(objectKey, exp, contentType),
    type: contentType,
  });
  return `${appUrl()}/api/storage/local-upload?${params.toString()}`;
}

export function verifyLocalUpload(input: {
  objectKey: string;
  exp: string;
  sig: string;
  contentType: string;
}): boolean {
  if (!isUploadObjectKey(input.objectKey)) {
    return false;
  }
  if (!/^\d+$/.test(input.exp) || !/^[a-f0-9]{64}$/.test(input.sig)) {
    return false;
  }
  const exp = Number(input.exp);
  const now = Date.now();
  if (!Number.isSafeInteger(exp) || exp < now - 60_000 || exp > now + UPLOAD_TTL_MS + 60_000) {
    return false;
  }
  return signaturesMatch(signature(input.objectKey, exp, input.contentType), input.sig);
}

function purposeFromKey(objectKey: string): UploadPurpose | null {
  if (objectKey.startsWith(`${SOURCE_PURPOSE}/`)) {
    return SOURCE_PURPOSE;
  }
  if (objectKey.startsWith(`${CONVERT_PURPOSE}/`)) {
    return CONVERT_PURPOSE;
  }
  if (objectKey.startsWith(`${SCIVIS_PURPOSE}/`)) {
    return SCIVIS_PURPOSE;
  }
  return null;
}

async function findOwned(userId: string, objectKey: string, purpose: UploadPurpose) {
  const [row] = await getDb()
    .select()
    .from(uploadObject)
    .where(and(eq(uploadObject.userId, userId), eq(uploadObject.objectKey, objectKey), eq(uploadObject.purpose, purpose)))
    .limit(1);
  return row ?? null;
}

export async function presignSourceUpload(input: {
  userId: string;
  purpose: UploadPurpose;
  filename: string;
  contentType: string;
  size?: number;
}): Promise<{ uploadUrl: string; objectKey: string; headers: { "content-type": string } }> {
  const extension = extensionFor(input.purpose, input.contentType);
  if (!extension) {
    throw new UploadRequestError(typeMessage(input.purpose), 400);
  }
  if (input.size !== undefined && (!Number.isInteger(input.size) || input.size < 1 || input.size > MAX_SOURCE_BYTES)) {
    throw new UploadRequestError(sizeMessage(input.purpose), 400);
  }
  const owner = userIdSegment(input.userId);
  const objectKey = `${input.purpose}/${owner}/${randomUUID()}.${extension}`;
  await getDb().insert(uploadObject).values({
    id: randomUUID(),
    objectKey,
    userId: input.userId,
    purpose: input.purpose,
    filename: safeFilename(input.filename),
    contentType: input.contentType,
    size: 0,
    status: "pending",
  });
  const headers = { "content-type": input.contentType };
  const uploadUrl = isR2Configured() ? await presignSourcePut(objectKey, input.contentType, 600) : localUploadUrl(objectKey, input.contentType);
  return { uploadUrl, objectKey, headers };
}

export async function writeLocalSource(objectKey: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const purposeForSize = purposeFromKey(objectKey) ?? SOURCE_PURPOSE;
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new UploadRequestError(sizeMessage(purposeForSize), 400);
  }
  const extension = extensionFor(purposeForSize, contentType);
  if (!extension || !objectKey.endsWith(`.${extension}`)) {
    throw new UploadRequestError("Content type does not match the upload", 400);
  }
  const [row] = await getDb().select().from(uploadObject).where(eq(uploadObject.objectKey, objectKey)).limit(1);
  const purpose = purposeFromKey(objectKey);
  if (!row || !purpose || row.purpose !== purpose) {
    throw new UploadRequestError("Upload was not found", 404);
  }
  if (row.status === "ready") {
    throw new UploadRequestError("Upload is already complete", 409);
  }
  if (row.contentType !== contentType) {
    throw new UploadRequestError("Content type does not match the upload", 400);
  }
  const wrote = await writePrivateObject(objectKey, bytes);
  if (!wrote) {
    throw new UploadRequestError("Upload was not found", 404);
  }
}

export async function completeSourceUpload(userId: string, objectKey: string): Promise<{ objectKey: string; status: "ready"; size: number; sha256: string }> {
  const purpose = purposeFromKey(objectKey);
  if (!purpose || !isUploadObjectKey(objectKey) || !objectKey.startsWith(`${purpose}/${userId}/`)) {
    throw new UploadRequestError("Upload was not found", 404);
  }
  const row = await findOwned(userId, objectKey, purpose);
  if (!row) {
    throw new UploadRequestError("Upload was not found", 404);
  }
  if (row.status === "ready" && row.sha256) {
    return { objectKey, status: "ready", size: row.size, sha256: row.sha256 };
  }
  const bytes = await readPrivateObject(objectKey);
  if (!bytes || bytes.byteLength < 1) {
    throw new UploadRequestError("Upload is incomplete", 400);
  }
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    await deletePrivateObject(objectKey);
    throw new UploadRequestError(sizeMessage(purpose), 400);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const updated = await getDb()
    .update(uploadObject)
    .set({ status: "ready", size: bytes.byteLength, sha256, updatedAt: new Date() })
    .where(and(eq(uploadObject.id, row.id), eq(uploadObject.status, "pending")))
    .returning({ id: uploadObject.id });
  if (updated.length === 0) {
    const current = await findOwned(userId, objectKey, purpose);
    if (current?.status === "ready" && current.sha256) {
      return { objectKey, status: "ready", size: current.size, sha256: current.sha256 };
    }
    throw new UploadRequestError("Upload is incomplete", 400);
  }
  return { objectKey, status: "ready", size: bytes.byteLength, sha256 };
}

export async function readReadyUpload(
  userId: string,
  objectKey: string,
  purpose: UploadPurpose,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const row = await findOwned(userId, objectKey, purpose);
  if (!row || row.status !== "ready") {
    throw new Error("Source image is missing");
  }
  const bytes = await readPrivateObject(objectKey);
  if (!bytes || bytes.byteLength < 1) {
    throw new Error("Source image is missing");
  }
  return { bytes, mimeType: row.contentType };
}

export async function readReadySource(userId: string, objectKey: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  return readReadyUpload(userId, objectKey, SOURCE_PURPOSE);
}
