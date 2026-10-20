import { z } from "zod";
import { BillingConfigError, createCheckout, isCreditPackId } from "@/lib/billing";
import { jsonNoStore } from "@/lib/http";
import { IdempotencyKeyError, readIdempotencyKey } from "@/lib/idempotency";
import { takeRateLimit } from "@/lib/rate-limit";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  pack: z.string().trim().min(1).max(64),
});

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  if (!takeRateLimit(`billing:${sessionUser.id}`, 20, 60_000)) {
    return jsonNoStore({ error: "Too many requests" }, 429);
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonNoStore({ error: "Invalid request" }, 400);
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success || !isCreditPackId(parsed.data.pack)) {
    return jsonNoStore({ error: "Invalid request" }, 400);
  }
  try {
    const idempotencyKey = readIdempotencyKey(request) ?? undefined;
    const url = await createCheckout({ userId: sessionUser.id, packId: parsed.data.pack, idempotencyKey });
    return jsonNoStore({ url });
  } catch (error) {
    if (error instanceof IdempotencyKeyError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 400);
    }
    if (error instanceof BillingConfigError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 503);
    }
    console.error("checkout failed", error instanceof Error ? error.message : "unknown");
    return jsonNoStore({ error: "Could not start checkout" }, 500);
  }
}
