import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const SOURCE_KEY = /^ai-drawing-source\/[A-Za-z0-9_-]{1,128}\/[0-9a-f-]{36}\.(png|jpeg|webp)$/;

export function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function mediaRoot(): string {
  return process.env.LOCAL_MEDIA_DIR || path.join(process.cwd(), ".data");
}

export function isSourceObjectKey(key: string): boolean {
  return SOURCE_KEY.test(key);
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET &&
      process.env.R2_ENDPOINT &&
      process.env.CDN_PUBLIC_BASE,
  );
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return "jpeg";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "png";
}

function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

let r2Client: S3Client | undefined;

function resolveSourcePath(key: string): string | null {
  if (!isSourceObjectKey(key)) {
    return null;
  }
  const root = path.resolve(mediaRoot());
  const filePath = path.resolve(root, ...key.split("/"));
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return filePath;
}

function getR2Client(): S3Client {
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  return r2Client;
}

export async function persistGeneratedImage(input: {
  userId: string;
  bytes: Uint8Array;
  mimeType: string;
}): Promise<{ url: string; format: string }> {
  const format = extensionFor(input.mimeType);
  const hash = contentHash(input.bytes);
  const objectName = `${randomUUID()}.${format}`;
  const key = `image-results/${input.userId}/${hash}/${objectName}`;

  if (isR2Configured()) {
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: Buffer.from(input.bytes),
        ContentType: input.mimeType,
      }),
    );
    const base = (process.env.CDN_PUBLIC_BASE ?? "").replace(/\/$/, "");
    return { url: `${base}/${key}`, format };
  }

  const directory = path.join(mediaRoot(), "image-results", input.userId, hash);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, objectName), input.bytes);
  return { url: `${appUrl()}/api/media/${key}`, format };
}

export async function presignSourcePut(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
  if (!isSourceObjectKey(key) || !isR2Configured()) {
    throw new Error("R2 is not configured");
  }
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getR2Client(), command, { expiresIn: expiresInSeconds });
}

export async function readPrivateObject(key: string): Promise<Uint8Array | null> {
  if (!isSourceObjectKey(key)) {
    return null;
  }
  if (isR2Configured()) {
    try {
      const response = await getR2Client().send(
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: key,
        }),
      );
      if (!response.Body) {
        return null;
      }
      return response.Body.transformToByteArray();
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "NoSuchKey" || name === "NotFound") {
        return null;
      }
      throw error;
    }
  }
  const filePath = resolveSourcePath(key);
  if (!filePath) {
    return null;
  }
  try {
    return new Uint8Array(await readFile(filePath));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writePrivateObject(key: string, bytes: Uint8Array): Promise<boolean> {
  const filePath = resolveSourcePath(key);
  if (!filePath) {
    return false;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  return true;
}

export async function deletePrivateObject(key: string): Promise<void> {
  if (!isSourceObjectKey(key)) {
    return;
  }
  if (isR2Configured()) {
    await getR2Client().send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
      }),
    );
    return;
  }
  const filePath = resolveSourcePath(key);
  if (!filePath) {
    return;
  }
  try {
    await unlink(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
