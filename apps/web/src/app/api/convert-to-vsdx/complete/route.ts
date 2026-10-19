import { z } from "zod";
import { jsonNoStore } from "@/lib/http";
import { getSessionUser } from "@/lib/session";
import { readVsdxStub, VSDX_CODE, VSDX_ERROR } from "@/lib/vsdx-stub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  jobId: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
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
  const row = await readVsdxStub(sessionUser.id, parsed.data.jobId);
  if (!row) {
    return jsonNoStore({ error: "Not found" }, 404);
  }
  return jsonNoStore({ error: VSDX_ERROR, errorCode: VSDX_CODE }, 501);
}
