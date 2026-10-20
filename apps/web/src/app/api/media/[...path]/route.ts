import { readFile } from "node:fs/promises";
import path from "node:path";
import { mediaRoot } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const HASH_SEGMENT = /^[a-f0-9]{64}$/;
const FILE_SEGMENT = /^[0-9a-f-]{36}\.(png|jpe?g|webp|svg|pptx|pdf|tiff|xlsx|vsdx)$/;

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  tiff: "image/tiff",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  vsdx: "application/vnd.ms-visio.drawing",
};

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await context.params;
  if (parts.length !== 4 || parts[0] !== "image-results") {
    return new Response("Not found", { status: 404 });
  }
  const [, userId, hash, fileName] = parts;
  if (!userId || !hash || !fileName || !SAFE_SEGMENT.test(userId) || !HASH_SEGMENT.test(hash) || !FILE_SEGMENT.test(fileName)) {
    return new Response("Not found", { status: 404 });
  }
  const root = path.resolve(mediaRoot());
  const filePath = path.resolve(root, "image-results", userId, hash, fileName);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const bytes = await readFile(filePath);
    const extension = fileName.slice(fileName.lastIndexOf(".") + 1);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
