import { z } from "zod";
import { SCI_VIS_CHART_TYPES, SCI_VIS_JOURNALS, SCI_VIS_LAYOUTS, SCI_VIS_PALETTES, SCI_VIS_WIDTHS } from "@sci-draw/schemas";
import { jsonNoStore } from "@/lib/http";
import { takeRateLimit } from "@/lib/rate-limit";
import { getSessionUser } from "@/lib/session";
import { InsufficientCreditsError, prepareSciVis, SciVisConflictError, SciVisInputError, sciVisSseResponse } from "@/lib/sci-vis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  requestId: z.string().trim().max(80).optional(),
  data: z.object({
    objectKey: z.string().trim().min(1).max(512),
    filename: z.string().trim().max(180).optional(),
  }),
  chartTypes: z.array(z.enum(SCI_VIS_CHART_TYPES)).min(1).max(4),
  journalStyle: z.enum(SCI_VIS_JOURNALS).default("none"),
  figureWidth: z.enum(SCI_VIS_WIDTHS).default("single"),
  colorPalette: z.enum(SCI_VIS_PALETTES).default("default"),
  multiChartLayout: z.enum(SCI_VIS_LAYOUTS).default("single"),
  fileContext: z.string().trim().max(2000).optional(),
  conversationId: z.string().trim().max(128).optional(),
  followUpInstruction: z.string().trim().max(2000).optional(),
  currentCode: z.string().max(20_000).optional(),
  baseGenerationId: z.string().trim().max(128).optional(),
});

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  if (!takeRateLimit(`sci-vis:${sessionUser.id}`, 10, 60_000)) {
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
  try {
    const prepared = await prepareSciVis(sessionUser.id, {
      requestId: parsed.data.requestId,
      objectKey: parsed.data.data.objectKey,
      filename: parsed.data.data.filename,
      chartTypes: parsed.data.chartTypes,
      journalStyle: parsed.data.journalStyle,
      figureWidth: parsed.data.figureWidth,
      colorPalette: parsed.data.colorPalette,
      multiChartLayout: parsed.data.multiChartLayout,
      fileContext: parsed.data.fileContext,
      conversationId: parsed.data.conversationId,
      followUpInstruction: parsed.data.followUpInstruction,
      currentCode: parsed.data.currentCode,
      baseGenerationId: parsed.data.baseGenerationId,
    });
    return sciVisSseResponse(prepared);
  } catch (error) {
    if (error instanceof SciVisInputError) {
      return jsonNoStore({ error: error.message }, 400);
    }
    if (error instanceof SciVisConflictError) {
      return jsonNoStore({ error: error.message }, 409);
    }
    if (error instanceof InsufficientCreditsError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 402);
    }
    console.error("sci-vis prepare failed", error instanceof Error ? error.message : "unknown");
    return jsonNoStore({ error: "Could not chart the table" }, 500);
  }
}
