import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { job } from "@/db/schema";
import { getDb } from "@/db";
import { jsonNoStore } from "@/lib/http";
import { takeRateLimit } from "@/lib/rate-limit";
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
  const [row] = await getDb()
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.id, parsed.data.generationId), eq(job.userId, sessionUser.id), eq(job.type, "sci_vis")))
    .limit(1);
  if (!row) {
    return jsonNoStore({ error: "Chart was not found" }, 404);
  }
  return jsonNoStore(
    {
      error: "Spreadsheet export is not available in this release",
      errorCode: "NOT_IMPLEMENTED",
    },
    501,
  );
}
