import { jsonNoStore } from "@/lib/http";
import { mapPublicError, readPublicJob, requireApiUser } from "@/lib/public-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ job_id: string }> }) {
  try {
    const { userId } = await requireApiUser(request);
    const { job_id: jobId } = await context.params;
    const view = await readPublicJob(userId, jobId);
    if (!view) {
      return jsonNoStore({ error: "Job was not found", error_code: "NOT_FOUND" }, 404);
    }
    return jsonNoStore(view);
  } catch (error) {
    return mapPublicError(error);
  }
}
