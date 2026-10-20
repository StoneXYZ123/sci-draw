import { jsonNoStore } from "@/lib/http";
import { takeRateLimit } from "@/lib/rate-limit";
import { mapPublicError, publicStatusCode, readPublicIdempotency, requireApiUser, startPublicGeneration } from "@/lib/public-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { userId } = await requireApiUser(request);
    if (!takeRateLimit(`v1:${userId}`, 60, 60_000)) {
      return jsonNoStore({ error: "Too many requests", error_code: "RATE_LIMITED" }, 429);
    }
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonNoStore({ error: "Invalid request", error_code: "INVALID_REQUEST" }, 400);
    }
    const view = await startPublicGeneration(userId, payload, readPublicIdempotency(request));
    return jsonNoStore(view, publicStatusCode(view));
  } catch (error) {
    return mapPublicError(error);
  }
}
