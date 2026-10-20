import { z } from "zod";
import { InsufficientCreditsError } from "@/lib/credits";
import { jsonNoStore } from "@/lib/http";
import { IdempotencyConflictError, IdempotencyKeyError, readIdempotencyKey } from "@/lib/idempotency";
import { takeRateLimit } from "@/lib/rate-limit";
import { ExportRequestError, exportSciVisXlsx } from "@/lib/sci-vis-export";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  generationId: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  if (!takeRateLimit(`sci-vis-xlsx:${sessionUser.id}`, 20, 60_000)) {
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
    const exported = await exportSciVisXlsx({
      userId: sessionUser.id,
      generationId: parsed.data.generationId,
      idempotencyKey: readIdempotencyKey(request),
    });
    return jsonNoStore(exported);
  } catch (error) {
    if (error instanceof IdempotencyKeyError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 400);
    }
    if (error instanceof IdempotencyConflictError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 409);
    }
    if (error instanceof ExportRequestError) {
      return jsonNoStore({ error: error.message, ...(error.errorCode ? { errorCode: error.errorCode } : {}) }, error.status);
    }
    if (error instanceof InsufficientCreditsError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 402);
    }
    console.error("xlsx export failed", error instanceof Error ? error.message : "unknown");
    return jsonNoStore({ error: "Could not export the spreadsheet" }, 500);
  }
}
