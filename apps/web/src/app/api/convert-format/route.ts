import { z } from "zod";
import { convertUpload, ConvertInputError, InsufficientCreditsError, type ConvertTarget } from "@/lib/convert";
import { jsonNoStore } from "@/lib/http";
import { takeRateLimit } from "@/lib/rate-limit";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  objectKey: z.string().trim().min(1).max(512),
  filename: z.string().trim().min(1).max(180),
  format: z.enum(["svg", "pptx", "png", "pdf", "tiff"]),
  mode: z.enum(["text-only", "full"]).optional(),
  dpi: z.union([z.literal(300), z.literal(600), z.literal(1000)]).optional(),
});

function targetFrom(body: z.infer<typeof bodySchema>): ConvertTarget {
  switch (body.format) {
    case "svg":
      return { format: "svg", mode: body.mode ?? "full" };
    case "pptx":
      return { format: "pptx" };
    case "png":
    case "pdf":
    case "tiff":
      return { format: body.format, dpi: body.dpi ?? 300 };
    default: {
      const neverFormat: never = body.format;
      throw new ConvertInputError(`Unsupported format ${neverFormat}`);
    }
  }
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  if (!takeRateLimit(`convert:${sessionUser.id}`, 20, 60_000)) {
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
    const result = await convertUpload({
      userId: sessionUser.id,
      objectKey: parsed.data.objectKey,
      target: targetFrom(parsed.data),
    });
    return jsonNoStore({ downloadUrl: result.url, creditsConsumed: result.creditsConsumed, format: parsed.data.format });
  } catch (error) {
    if (error instanceof ConvertInputError) {
      return jsonNoStore({ error: error.message }, 400);
    }
    if (error instanceof InsufficientCreditsError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 402);
    }
    console.error("format convert failed", error instanceof Error ? error.message : "unknown");
    return jsonNoStore({ error: "Could not convert the image" }, 500);
  }
}
