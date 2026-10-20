import { z } from "zod";
import { jsonNoStore } from "@/lib/http";
import { getSessionUser } from "@/lib/session";
import { readVsdxJob, VSDX_CODE, VSDX_ERROR } from "@/lib/vsdx-job";

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
  const row = await readVsdxJob(sessionUser.id, parsed.data.jobId);
  if (!row) {
    return jsonNoStore({ error: "Not found" }, 404);
  }
  if (row.status === "pending" || row.status === "running") {
    return jsonNoStore({ error: "VSDX export is still running", errorCode: "JOB_PENDING" }, 409);
  }
  if (row.status === "completed" && row.vsdxUrl) {
    return jsonNoStore({ jobId: row.jobId, vsdxUrl: row.vsdxUrl, creditsConsumed: row.creditsConsumed ?? 20 });
  }
  if (row.errorCode === VSDX_CODE) {
    return jsonNoStore({ error: row.error ?? VSDX_ERROR, errorCode: VSDX_CODE }, 501);
  }
  return jsonNoStore({ error: row.error ?? "VSDX export failed", errorCode: row.errorCode ?? "VSDX_FAILED" }, 422);
}
