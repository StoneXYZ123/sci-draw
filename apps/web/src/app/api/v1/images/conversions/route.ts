import { jsonNoStore } from "@/lib/http";
import { takeRateLimit } from "@/lib/rate-limit";
import { mapPublicError, publicStatusCode, readPublicIdempotency, requireApiUser, startPublicConversion } from "@/lib/public-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { userId } = await requireApiUser(request);
    if (!takeRateLimit(`v1:${userId}`, 60, 60_000)) {
      return jsonNoStore({ error: "Too many requests", error_code: "RATE_LIMITED" }, 429);
    }
    const started = await startPublicConversion(userId, request, readPublicIdempotency(request));
    return jsonNoStore(started.view, publicStatusCode(started.view));
  } catch (error) {
    return mapPublicError(error);
  }
}
