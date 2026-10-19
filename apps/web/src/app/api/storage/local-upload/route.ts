import { jsonNoStore } from "@/lib/http";
import { verifyLocalUpload, writeLocalSource, UploadRequestError } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mediaType(value: string | null): string {
  return (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const objectKey = url.searchParams.get("key") ?? "";
  const exp = url.searchParams.get("exp") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  const signedType = url.searchParams.get("type") ?? "";
  if (!verifyLocalUpload({ objectKey, exp, sig, contentType: signedType })) {
    return jsonNoStore({ error: "Upload link is invalid" }, 403);
  }
  if (mediaType(request.headers.get("content-type")) !== signedType) {
    return jsonNoStore({ error: "Content type does not match the upload" }, 400);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  try {
    await writeLocalSource(objectKey, bytes, signedType);
  } catch (error) {
    if (error instanceof UploadRequestError) {
      return jsonNoStore({ error: error.message }, error.status);
    }
    console.error("local upload failed", error instanceof Error ? error.message : "unknown");
    return jsonNoStore({ error: "Could not store the image" }, 500);
  }
  return jsonNoStore({ ok: true });
}
