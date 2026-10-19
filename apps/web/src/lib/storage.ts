import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function mediaRoot(): string {
  return process.env.LOCAL_MEDIA_DIR || path.join(process.cwd(), ".data");
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
