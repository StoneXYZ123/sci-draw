import { eq } from "drizzle-orm";
import { job } from "@/db/schema";
import { getDb } from "@/db";
import { processDrawingJob, recoverIfStale } from "@/lib/drawing-job";
import { jsonNoStore } from "@/lib/http";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASK_ID = /^[a-f0-9]{64}$/;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  const { id } = await context.params;
  if (!TASK_ID.test(id)) {
    return jsonNoStore({ error: "Not found" }, 404);
  }
  const [found] = await getDb().select().from(job).where(eq(job.id, id)).limit(1);
  if (!found || found.userId !== sessionUser.id || found.type !== "generate") {
    return jsonNoStore({ error: "Not found" }, 404);
  }
  const row = await recoverIfStale(found);
  if (row.status === "pending") {
    void processDrawingJob(row.id);
    return jsonNoStore({ id: row.id, status: "pending" });
  }
  if (row.status === "running") {
    return jsonNoStore({ id: row.id, status: "running" });
  }
  if (row.status === "completed" || row.status === "failed") {
    return jsonNoStore({ id: row.id, status: row.status, result: row.result });
  }
  return jsonNoStore({ error: "Not found" }, 404);
}
