import { readResultObject, resultKeyForUser } from "@/lib/storage";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  tiff: "image/tiff",
};

export async function GET(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return new Response("Unauthorized", { status: 401 });
  }
  const rawUrl = new URL(request.url).searchParams.get("url") ?? "";
  if (rawUrl.length < 1 || rawUrl.length > 2000) {
    return new Response("Not found", { status: 404 });
  }
  const key = resultKeyForUser(rawUrl, sessionUser.id);
  if (!key) {
    return new Response("Not found", { status: 404 });
  }
  const bytes = await readResultObject(key);
  if (!bytes) {
    return new Response("Not found", { status: 404 });
  }
  const extension = key.slice(key.lastIndexOf(".") + 1);
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "content-disposition": `attachment; filename="figure.${extension}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
