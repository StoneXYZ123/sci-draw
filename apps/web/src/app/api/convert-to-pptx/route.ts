import { z } from "zod";
import { convertImageUrl, ConvertInputError, InsufficientCreditsError } from "@/lib/convert";
import { jsonNoStore } from "@/lib/http";
import { takeRateLimit } from "@/lib/rate-limit";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  imageUrl: z.string().trim().url().max(2000),
  messageId: z.string().trim().max(128).optional(),
  conversationId: z.string().trim().max(128).optional(),
  composerState: z.unknown().optional(),
});

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
    const result = await convertImageUrl({
      userId: sessionUser.id,
      imageUrl: parsed.data.imageUrl,
      target: { format: "pptx" },
    });
    return jsonNoStore({ pptxUrl: result.url, creditsConsumed: result.creditsConsumed });
  } catch (error) {
    if (error instanceof ConvertInputError) {
      return jsonNoStore({ error: error.message }, 400);
    }
    if (error instanceof InsufficientCreditsError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 402);
    }
    console.error("pptx convert failed", error instanceof Error ? error.message : "unknown");
    return jsonNoStore({ error: "Could not convert the image" }, 500);
  }
}
