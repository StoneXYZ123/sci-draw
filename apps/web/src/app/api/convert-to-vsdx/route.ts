import { z } from "zod";
import { jsonNoStore } from "@/lib/http";
import { getSessionUser } from "@/lib/session";
import { readVsdxStub, recordVsdxStub } from "@/lib/vsdx-stub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  imageUrl: z.string().trim().url().max(2000).optional(),
  messageId: z.string().trim().max(128).optional(),
  conversationId: z.string().trim().max(128).optional(),
});

const JOB_ID = /^[a-f0-9]{64}$/;

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  let payload: unknown = {};
  if (request.headers.get("content-length") !== "0") {
    try {
      payload = await request.json();
    } catch {
      return jsonNoStore({ error: "Invalid request" }, 400);
    }
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return jsonNoStore({ error: "Invalid request" }, 400);
  }
  const recorded = await recordVsdxStub(sessionUser.id, parsed.data);
  return jsonNoStore(recorded, 202);
}

export async function GET(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
  if (!JOB_ID.test(jobId)) {
    return jsonNoStore({ error: "Not found" }, 404);
  }
  const row = await readVsdxStub(sessionUser.id, jobId);
  if (!row) {
    return jsonNoStore({ error: "Not found" }, 404);
  }
  return jsonNoStore(row);
}
