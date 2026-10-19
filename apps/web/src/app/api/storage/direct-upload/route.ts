import { z } from "zod";
import { jsonNoStore } from "@/lib/http";
import { takeRateLimit } from "@/lib/rate-limit";
import { getSessionUser } from "@/lib/session";
import { completeSourceUpload, presignSourceUpload, UPLOAD_PURPOSES, UploadRequestError } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const presignSchema = z.object({
  action: z.literal("presign"),
  purpose: z.enum(UPLOAD_PURPOSES),
  filename: z.string().trim().min(1).max(180),
  contentType: z.string().trim().min(1).max(120),
  size: z.number().int().positive().optional(),
});

const completeSchema = z.object({
  action: z.literal("complete"),
  purpose: z.enum(UPLOAD_PURPOSES),
  objectKey: z.string().trim().min(1).max(512),
});

const bodySchema = z.discriminatedUnion("action", [presignSchema, completeSchema]);

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  if (!takeRateLimit(`upload:${sessionUser.id}`, 30, 60_000)) {
    return jsonNoStore({ error: "Too many requests" }, 429);
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonNoStore({ error: "Invalid request" }, 400);
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return jsonNoStore({ error: "Invalid request" }, 400);
  }
  try {
    switch (parsed.data.action) {
      case "presign":
        return jsonNoStore(
          await presignSourceUpload({
            userId: sessionUser.id,
            purpose: parsed.data.purpose,
            filename: parsed.data.filename,
            contentType: parsed.data.contentType,
            size: parsed.data.size,
          }),
        );
      case "complete":
        if (!parsed.data.objectKey.startsWith(`${parsed.data.purpose}/`)) {
          return jsonNoStore({ error: "Upload was not found" }, 404);
        }
        return jsonNoStore(await completeSourceUpload(sessionUser.id, parsed.data.objectKey));
      default: {
        const neverAction: never = parsed.data;
        return jsonNoStore({ error: `Invalid request ${String(neverAction)}` }, 400);
      }
    }
  } catch (error) {
    if (error instanceof UploadRequestError) {
      return jsonNoStore({ error: error.message }, error.status);
    }
    console.error("direct upload failed", error instanceof Error ? error.message : "unknown");
    return jsonNoStore({ error: "Could not upload the image" }, 500);
  }
}
