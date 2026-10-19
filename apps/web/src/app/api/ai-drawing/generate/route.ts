import { after } from "next/server";
import { GenerateBodyError, parseGenerateBody } from "@sci-draw/schemas";
import { createDrawingJob, InsufficientCreditsError, processDrawingJob, SourceImageError, UnknownConversationError } from "@/lib/drawing-job";
import { jsonNoStore } from "@/lib/http";
import { takeRateLimit } from "@/lib/rate-limit";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  if (!takeRateLimit(`generate:${sessionUser.id}`, 20, 60_000)) {
    return jsonNoStore({ error: "Too many requests" }, 429);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonNoStore({ error: "Invalid request" }, 400);
  }

  try {
    const body = parseGenerateBody(payload);
    const created = await createDrawingJob(sessionUser.id, body);
    if (created.status === "pending") {
      after(() => processDrawingJob(created.id));
    }
    return jsonNoStore({ id: created.id, status: created.status === "running" ? "pending" : created.status }, 202, {
      "retry-after": "2",
    });
  } catch (error) {
    if (error instanceof GenerateBodyError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 400);
    }
    if (error instanceof UnknownConversationError || error instanceof SourceImageError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 400);
    }
    if (error instanceof InsufficientCreditsError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 402);
    }
    console.error("generate failed", error instanceof Error ? error.message : "unknown");
    return jsonNoStore({ error: "Could not start generation" }, 500);
  }
}
