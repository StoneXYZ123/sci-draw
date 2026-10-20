import { createHash, randomBytes } from "node:crypto";
import { convertCredits, sciVisCredits, type RasterDpi, type SvgConvertMode } from "@sci-draw/credits";
import { parseTable, renderSciVisChart, resolveSciVisSandbox, SciVisEngineError, TableParseError, tableToCsv, type RasterFormat } from "@sci-draw/providers";
import {
  ASPECT_RATIOS,
  parseGenerateBody,
  RESOLUTIONS,
  SCI_VIS_CHART_TYPES,
  SCI_VIS_JOURNALS,
  SCI_VIS_LAYOUTS,
  SCI_VIS_PALETTES,
  SCI_VIS_WIDTHS,
  type DrawingGenerateBody,
  type SciVisChartType,
  type SciVisJournal,
  type SciVisLayout,
  type SciVisPalette,
  type SciVisWidth,
} from "@sci-draw/schemas";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { job } from "@/db/schema";
import { getDb } from "@/db";
import { userForApiKey } from "@/lib/api-keys";
import { renderConvertedFile, type ConvertTarget } from "@/lib/convert";
import { consumeReason, creditFamilyForJob, reserveReason, rollbackReason } from "@/lib/credit-family";
import { ensureSignupBonus, InsufficientCreditsError } from "@/lib/credits";
import { createDrawingJob, processDrawingJob, SourceImageError, UnknownConversationError } from "@/lib/drawing-job";
import { IdempotencyConflictError, IdempotencyKeyError, readIdempotencyKey, requestHash, scopedBatchId } from "@/lib/idempotency";
import { jsonNoStore } from "@/lib/http";
import { beginUserJob, claimRunning, finishJobFailure, finishJobSuccess, isStaleRunning, readJob } from "@/lib/job-start";
import { toPublicJob, type PublicJobView } from "@/lib/public-job";
import { persistUserFile } from "@/lib/storage";
import { CONVERT_PURPOSE, readReadyUpload, SCIVIS_PURPOSE, SOURCE_PURPOSE, storeReadyUpload, UploadRequestError } from "@/lib/uploads";
import { processVsdxJob, startVsdxJob, vsdxProviderConfigured, VSDX_CODE, VSDX_ERROR } from "@/lib/vsdx-job";

export class PublicInputError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode: string,
  ) {
    super(message);
    this.name = "PublicInputError";
  }
}

const generationSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  aspect_ratio: z.enum(ASPECT_RATIOS).default("4:3"),
  resolution: z.enum(RESOLUTIONS).default("2K"),
  count: z.number().int().min(1).max(4).default(1),
});

const chartSchema = z.object({
  chart_type: z.enum(SCI_VIS_CHART_TYPES).default("line"),
  journal_style: z.enum(SCI_VIS_JOURNALS).default("none"),
  figure_width: z.enum(SCI_VIS_WIDTHS).default("single"),
  color_palette: z.enum(SCI_VIS_PALETTES).default("default"),
  multi_chart_layout: z.enum(SCI_VIS_LAYOUTS).default("single"),
  file_context: z.string().trim().max(2000).optional(),
});

const convertSchema = z.object({
  format: z.enum(["svg", "pptx", "png", "pdf", "tiff", "vsdx"]),
  vector_mode: z.enum(["text-only", "full"]).default("full"),
  dpi: z.union([z.literal(300), z.literal(600), z.literal(1000)]).default(300),
});

export async function requireApiUser(request: Request): Promise<{ userId: string }> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(sd_\S+)$/i.exec(header);
  if (!match?.[1]) {
    throw new PublicInputError("API key is required", 401, "UNAUTHORIZED");
  }
  const found = await userForApiKey(match[1]);
  if (!found) {
    throw new PublicInputError("API key is invalid", 401, "UNAUTHORIZED");
  }
  await ensureSignupBonus(found.userId);
  return { userId: found.userId };
}

export function wantsWait(request: Request): boolean {
  return /\bwait\b/i.test(request.headers.get("prefer") ?? "");
}

function batchFor(scope: string, userId: string, key: string | null): string {
  if (key) {
    return scopedBatchId(scope, userId, key);
  }
  return `${scope}-${randomBytes(16).toString("hex")}`;
}

async function ownedJob(userId: string, jobId: string) {
  const [row] = await getDb().select().from(job).where(and(eq(job.id, jobId), eq(job.userId, userId))).limit(1);
  return row;
}

async function recoverOwned(row: typeof job.$inferSelect): Promise<typeof job.$inferSelect> {
  if (!isStaleRunning(row)) {
    return row;
  }
  const family = creditFamilyForJob(row.type);
  if (!family || row.type === "generate" || row.type === "sci_vis" || row.type === "sci_vis_xlsx") {
    return row;
  }
  await finishJobFailure({
    jobId: row.id,
    cost: row.creditsReserved,
    errorCode: "JOB_TIMEOUT",
    errorMessage: "The job timed out",
    rollbackReason: rollbackReason(family),
  });
  return (await readJob(row.id)) ?? row;
}

function kick(row: typeof job.$inferSelect): void {
  if (row.status !== "pending") {
    return;
  }
  switch (row.type) {
    case "generate":
      void processDrawingJob(row.id);
      return;
    case "public_convert":
      void processPublicConvert(row.id);
      return;
    case "public_chart":
      void processPublicChart(row.id);
      return;
    case "convert_vsdx":
      void processVsdxJob(row.id);
      return;
    default:
      return;
  }
}

export async function readPublicJob(userId: string, jobId: string): Promise<PublicJobView | null> {
  if (!/^[a-f0-9]{64}$/.test(jobId)) {
    return null;
  }
  const found = await ownedJob(userId, jobId);
  if (!found) {
    return null;
  }
  const row = await recoverOwned(found);
  kick(row);
  return toPublicJob(row);
}

function sameDrawing(existing: unknown, next: DrawingGenerateBody, nextHash: string, existingHash: string): boolean {
  if (existingHash && nextHash && existingHash !== nextHash) {
    return false;
  }
  let parsed: DrawingGenerateBody;
  try {
    parsed = parseGenerateBody(existing);
  } catch {
    return false;
  }
  return (
    parsed.mode === next.mode &&
    parsed.resolution === next.resolution &&
    parsed.aspectRatio === next.aspectRatio &&
    parsed.batchCount === next.batchCount &&
    (parsed.mode === "prompt" && next.mode === "prompt"
      ? parsed.prompt === next.prompt
      : parsed.mode !== "prompt" && next.mode !== "prompt" && parsed.supplementaryPrompt === next.supplementaryPrompt)
  );
}

async function startDrawing(input: {
  userId: string;
  body: DrawingGenerateBody;
  inputHash: string;
  scope: string;
  idempotencyKey: string | null;
}): Promise<PublicJobView> {
  const batchId = batchFor(input.scope, input.userId, input.idempotencyKey);
  const body = { ...input.body, batchId };
  if (input.idempotencyKey) {
    const [existing] = await getDb()
      .select()
      .from(job)
      .where(and(eq(job.userId, input.userId), eq(job.batchId, batchId)))
      .limit(1);
    if (existing) {
      const previousHash = typeof existing.request === "object" && existing.request && "publicHash" in existing.request ? String(existing.request.publicHash ?? "") : "";
      if (!sameDrawing(existing.request, body, input.inputHash, previousHash || input.inputHash)) {
        throw new IdempotencyConflictError();
      }
      kick(existing);
      return toPublicJob(existing);
    }
  }
  const created = await createDrawingJob(input.userId, body);
  if (!sameDrawing(created.request, body, "", "")) {
    throw new IdempotencyConflictError();
  }
  if (created.status === "pending") {
    kick(created);
  }
  return toPublicJob(created);
}

export async function startPublicGeneration(userId: string, payload: unknown, idempotencyKey: string | null): Promise<PublicJobView> {
  const parsed = generationSchema.safeParse(payload);
  if (!parsed.success) {
    throw new PublicInputError("Invalid request", 400, "INVALID_REQUEST");
  }
  const body = parseGenerateBody({
    prompt: parsed.data.prompt,
    templateId: "none",
    styleId: "none",
    aspectRatio: parsed.data.aspect_ratio,
    resolution: parsed.data.resolution,
    batchCount: parsed.data.count,
    batchId: "placeholder-batch",
    mode: "prompt",
    textLanguage: "en",
  });
  const inputHash = requestHash([parsed.data.prompt, parsed.data.aspect_ratio, parsed.data.resolution, parsed.data.count]);
  return startDrawing({ userId, body, inputHash, scope: "v1gen", idempotencyKey });
}

function sniffImage(bytes: Uint8Array, declared: string): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    return "image/webp";
  }
  if (declared === "image/png" || declared === "image/jpeg" || declared === "image/webp") {
    return declared;
  }
  return null;
}

async function readMultipart(request: Request): Promise<FormData> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("multipart/form-data")) {
    throw new PublicInputError("Use multipart form data", 400, "INVALID_REQUEST");
  }
  try {
    return await request.formData();
  } catch {
    throw new PublicInputError("Invalid form data", 400, "INVALID_REQUEST");
  }
}

function formFile(form: FormData, names: string[]): File {
  for (const name of names) {
    const value = form.get(name);
    if (value instanceof File && value.size > 0) {
      return value;
    }
  }
  throw new PublicInputError("A file is required", 400, "INVALID_REQUEST");
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function startPublicEdit(userId: string, request: Request, idempotencyKey: string | null): Promise<PublicJobView> {
  const form = await readMultipart(request);
  const file = formFile(form, ["image", "file"]);
  const prompt = formText(form, "prompt");
  if (!prompt) {
    throw new PublicInputError("prompt is required", 400, "INVALID_REQUEST");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(bytes, file.type);
  if (!mime) {
    throw new PublicInputError("Use a PNG, JPEG, or WebP image", 400, "INVALID_REQUEST");
  }
  if (bytes.byteLength > 5 * 1024 * 1024) {
    throw new PublicInputError("Image must be 5 MB or smaller", 400, "INVALID_REQUEST");
  }
  const aspect = formText(form, "aspect_ratio") || "4:3";
  const resolution = formText(form, "resolution") || "2K";
  const count = Number(formText(form, "count") || "1");
  const parsed = generationSchema.safeParse({
    prompt,
    aspect_ratio: aspect,
    resolution,
    count,
  });
  if (!parsed.success) {
    throw new PublicInputError("Invalid request", 400, "INVALID_REQUEST");
  }
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const inputHash = requestHash([prompt, parsed.data.aspect_ratio, parsed.data.resolution, parsed.data.count, fileHash]);
  if (idempotencyKey) {
    const batchId = scopedBatchId("v1edit", userId, idempotencyKey);
    const [existing] = await getDb().select().from(job).where(and(eq(job.userId, userId), eq(job.batchId, batchId))).limit(1);
    if (existing) {
      const previous = parseGenerateBody(existing.request);
      if (previous.mode !== "sketch" || previous.supplementaryPrompt !== prompt || previous.batchCount !== parsed.data.count || previous.resolution !== parsed.data.resolution || previous.aspectRatio !== parsed.data.aspect_ratio) {
        throw new IdempotencyConflictError();
      }
      const stored = await readReadyUpload(userId, previous.uploadedImageObjectKey, SOURCE_PURPOSE);
      const storedHash = createHash("sha256").update(stored.bytes).digest("hex");
      if (storedHash !== fileHash) {
        throw new IdempotencyConflictError();
      }
      kick(existing);
      return toPublicJob(existing);
    }
  }
  let objectKey: string;
  try {
    objectKey = await storeReadyUpload({
      userId,
      purpose: "ai-drawing-source",
      filename: file.name || "source.png",
      contentType: mime,
      bytes,
    });
  } catch (error) {
    if (error instanceof UploadRequestError) {
      throw new PublicInputError(error.message, error.status, "INVALID_REQUEST");
    }
    throw error;
  }
  const body = parseGenerateBody({
    supplementaryPrompt: prompt,
    uploadedImageObjectKey: objectKey,
    templateId: "none",
    styleId: "none",
    aspectRatio: parsed.data.aspect_ratio,
    resolution: parsed.data.resolution,
    batchCount: parsed.data.count,
    batchId: "placeholder-batch",
    mode: "sketch",
    textLanguage: "en",
  });
  return startDrawing({ userId, body, inputHash, scope: "v1edit", idempotencyKey });
}

function convertTarget(format: "svg" | "pptx" | "png" | "pdf" | "tiff", mode: SvgConvertMode, dpi: RasterDpi): ConvertTarget {
  switch (format) {
    case "svg":
      return { format: "svg", mode };
    case "pptx":
      return { format: "pptx" };
    case "png":
    case "pdf":
    case "tiff":
      return { format: format as RasterFormat, dpi };
    default: {
      const neverFormat: never = format;
      throw new PublicInputError(`Unsupported format ${neverFormat}`, 400, "INVALID_REQUEST");
    }
  }
}

export async function startPublicConversion(userId: string, request: Request, idempotencyKey: string | null): Promise<{ view: PublicJobView; wait: boolean }> {
  const form = await readMultipart(request);
  const file = formFile(form, ["image", "file"]);
  const parsed = convertSchema.safeParse({
    format: formText(form, "format") || "png",
    vector_mode: formText(form, "vector_mode") || "full",
    dpi: Number(formText(form, "dpi") || "300"),
  });
  if (!parsed.success) {
    throw new PublicInputError("Invalid request", 400, "INVALID_REQUEST");
  }
  if (parsed.data.format === "vsdx" && !vsdxProviderConfigured()) {
    throw new PublicInputError(VSDX_ERROR, 501, VSDX_CODE);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(bytes, file.type);
  if (!mime) {
    throw new PublicInputError("Use a PNG, JPEG, or WebP image", 400, "INVALID_REQUEST");
  }
  if (bytes.byteLength > 5 * 1024 * 1024) {
    throw new PublicInputError("Image must be 5 MB or smaller", 400, "INVALID_REQUEST");
  }
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const inputHash = requestHash([parsed.data.format, parsed.data.vector_mode, parsed.data.dpi, fileHash]);
  const batchId = batchFor(parsed.data.format === "vsdx" ? "vsdx" : "v1conv", userId, idempotencyKey);
  let objectKey: string;
  try {
    objectKey = await storeReadyUpload({
      userId,
      purpose: CONVERT_PURPOSE,
      filename: file.name || "figure.png",
      contentType: mime,
      bytes,
    });
  } catch (error) {
    if (error instanceof UploadRequestError) {
      throw new PublicInputError(error.message, error.status, "INVALID_REQUEST");
    }
    throw error;
  }
  if (parsed.data.format === "vsdx") {
    const started = await startVsdxJob({
      userId,
      batchId,
      request: { objectKey, filename: file.name || "figure.png", inputHash, source: "public_api" },
    });
    if (started.row.status === "pending") {
      if (wantsWait(request)) {
        await processVsdxJob(started.row.id);
        const fresh = await readJob(started.row.id);
        return { view: toPublicJob(fresh ?? started.row), wait: true };
      }
      void processVsdxJob(started.row.id);
    }
    return { view: toPublicJob(started.row), wait: wantsWait(request) };
  }
  const family = creditFamilyForJob("public_convert");
  if (family !== "convert") {
    throw new PublicInputError("Could not convert the image", 500, "CONVERT_FAILED");
  }
  const target = convertTarget(parsed.data.format, parsed.data.vector_mode, parsed.data.dpi);
  const credits = convertCredits(target.format === "svg" ? { kind: "svg", mode: target.mode } : target.format === "pptx" ? { kind: "pptx" } : { kind: "raster", dpi: target.dpi });
  const started = await beginUserJob({
    userId,
    type: "public_convert",
    batchId,
    credits,
    reserveReason: reserveReason(family),
    request: {
      objectKey,
      format: parsed.data.format,
      vectorMode: parsed.data.vector_mode,
      dpi: parsed.data.dpi,
      inputHash,
    },
  });
  if (started.row.status === "pending") {
    if (wantsWait(request)) {
      await processPublicConvert(started.row.id);
      const fresh = await readJob(started.row.id);
      return { view: toPublicJob(fresh ?? started.row), wait: true };
    }
    void processPublicConvert(started.row.id);
  }
  return { view: toPublicJob(started.row), wait: wantsWait(request) };
}

export async function processPublicConvert(jobId: string): Promise<void> {
  const running = await claimRunning(jobId, "public_convert");
  if (!running) {
    return;
  }
  const family = creditFamilyForJob("public_convert");
  if (!family) {
    return;
  }
  const request = typeof running.request === "object" && running.request ? (running.request as Record<string, unknown>) : {};
  try {
    const objectKey = typeof request.objectKey === "string" ? request.objectKey : "";
    const format = request.format;
    const vectorMode = request.vectorMode === "text-only" ? "text-only" : "full";
    const dpi = request.dpi === 600 || request.dpi === 1000 ? request.dpi : 300;
    if (format !== "svg" && format !== "pptx" && format !== "png" && format !== "pdf" && format !== "tiff") {
      throw new PublicInputError("Unsupported format", 400, "INVALID_REQUEST");
    }
    const source = await readReadyUpload(running.userId, objectKey, CONVERT_PURPOSE);
    const rendered = await renderConvertedFile({
      userId: running.userId,
      bytes: source.bytes,
      mimeType: source.mimeType,
      target: convertTarget(format, vectorMode, dpi),
    });
    await finishJobSuccess({
      jobId: running.id,
      userId: running.userId,
      creditsConsumed: rendered.credits,
      consumeReason: consumeReason(family),
      result: { files: [{ url: rendered.url, format: rendered.extension }], creditsConsumed: rendered.credits },
    });
  } catch (error) {
    await finishJobFailure({
      jobId: running.id,
      cost: running.creditsReserved,
      errorCode: "CONVERT_FAILED",
      errorMessage: error instanceof Error ? error.message : "Could not convert the image",
      rollbackReason: rollbackReason(family),
    });
  }
}

export async function startPublicChart(userId: string, request: Request, idempotencyKey: string | null): Promise<PublicJobView> {
  const form = await readMultipart(request);
  const file = formFile(form, ["data", "file"]);
  const parsed = chartSchema.safeParse({
    chart_type: formText(form, "chart_type") || "line",
    journal_style: formText(form, "journal_style") || "none",
    figure_width: formText(form, "figure_width") || "single",
    color_palette: formText(form, "color_palette") || "default",
    multi_chart_layout: formText(form, "multi_chart_layout") || "single",
    file_context: formText(form, "file_context") || undefined,
  });
  if (!parsed.success) {
    throw new PublicInputError("Invalid request", 400, "INVALID_REQUEST");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > 5 * 1024 * 1024) {
    throw new PublicInputError("File must be 5 MB or smaller", 400, "INVALID_REQUEST");
  }
  const filename = file.name || "table.csv";
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  try {
    parseTable(text, filename);
  } catch (error) {
    throw new PublicInputError(error instanceof TableParseError ? error.message : "The table could not be read", 400, "INVALID_REQUEST");
  }
  const contentType = filename.toLowerCase().endsWith(".tsv") ? "text/tab-separated-values" : filename.toLowerCase().endsWith(".txt") ? "text/plain" : "text/csv";
  let objectKey: string;
  try {
    objectKey = await storeReadyUpload({
      userId,
      purpose: SCIVIS_PURPOSE,
      filename,
      contentType,
      bytes,
    });
  } catch (error) {
    if (error instanceof UploadRequestError) {
      throw new PublicInputError(error.message, error.status, "INVALID_REQUEST");
    }
    throw error;
  }
  const family = creditFamilyForJob("public_chart");
  if (family !== "sci_vis") {
    throw new PublicInputError("Could not chart the table", 500, "SCIVIS_FAILED");
  }
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const inputHash = requestHash([
    parsed.data.chart_type,
    parsed.data.journal_style,
    parsed.data.figure_width,
    parsed.data.color_palette,
    parsed.data.multi_chart_layout,
    parsed.data.file_context,
    fileHash,
  ]);
  const started = await beginUserJob({
    userId,
    type: "public_chart",
    batchId: batchFor("v1chart", userId, idempotencyKey),
    credits: sciVisCredits("generate"),
    reserveReason: reserveReason(family),
    request: { ...parsed.data, objectKey, filename, inputHash },
  });
  if (started.row.status === "pending") {
    void processPublicChart(started.row.id);
  }
  return toPublicJob(started.row);
}

export async function processPublicChart(jobId: string): Promise<void> {
  const running = await claimRunning(jobId, "public_chart");
  if (!running) {
    return;
  }
  const family = creditFamilyForJob("public_chart");
  if (!family) {
    return;
  }
  const request = typeof running.request === "object" && running.request ? (running.request as Record<string, unknown>) : {};
  try {
    const objectKey = typeof request.objectKey === "string" ? request.objectKey : "";
    const filename = typeof request.filename === "string" ? request.filename : "table.csv";
    const source = await readReadyUpload(running.userId, objectKey, SCIVIS_PURPOSE);
    const table = parseTable(new TextDecoder("utf-8", { fatal: false }).decode(source.bytes), filename);
    const sandbox = resolveSciVisSandbox({
      SCIVIS_SANDBOX: process.env.SCIVIS_SANDBOX,
      E2B_API_KEY: process.env.E2B_API_KEY,
      MODAL_TOKEN_ID: process.env.MODAL_TOKEN_ID,
      MODAL_TOKEN_SECRET: process.env.MODAL_TOKEN_SECRET,
      SCIVIS_MODAL_ENDPOINT: process.env.SCIVIS_MODAL_ENDPOINT,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    });
    const chartType = SCI_VIS_CHART_TYPES.find((item) => item === request.chart_type) ?? "line";
    const chart = await renderSciVisChart({
      csv: tableToCsv(table),
      chartTypes: [chartType as SciVisChartType],
      journalStyle: (SCI_VIS_JOURNALS.find((item) => item === request.journal_style) ?? "none") as SciVisJournal,
      figureWidth: (SCI_VIS_WIDTHS.find((item) => item === request.figure_width) ?? "single") as SciVisWidth,
      colorPalette: (SCI_VIS_PALETTES.find((item) => item === request.color_palette) ?? "default") as SciVisPalette,
      multiChartLayout: (SCI_VIS_LAYOUTS.find((item) => item === request.multi_chart_layout) ?? "single") as SciVisLayout,
      fileContext: typeof request.file_context === "string" ? request.file_context : undefined,
      sandbox,
      geminiApiKey: process.env.GEMINI_API_KEY,
      geminiModel: process.env.SCIVIS_LLM_MODEL,
      e2bApiKey: process.env.E2B_API_KEY,
      modalEndpoint: process.env.SCIVIS_MODAL_ENDPOINT,
      modalTokenId: process.env.MODAL_TOKEN_ID,
      modalTokenSecret: process.env.MODAL_TOKEN_SECRET,
    });
    const stored = await persistUserFile({
      userId: running.userId,
      bytes: chart.png,
      mimeType: "image/png",
      extension: "png",
    });
    await finishJobSuccess({
      jobId: running.id,
      userId: running.userId,
      creditsConsumed: running.creditsReserved,
      consumeReason: consumeReason(family),
      result: {
        files: [{ url: stored.url, format: "png" }],
        engine: chart.engine,
        creditsConsumed: running.creditsReserved,
      },
    });
  } catch (error) {
    const errorCode = error instanceof SciVisEngineError ? error.errorCode : "SCIVIS_FAILED";
    await finishJobFailure({
      jobId: running.id,
      cost: running.creditsReserved,
      errorCode,
      errorMessage: error instanceof Error ? error.message : "Could not chart the table",
      rollbackReason: rollbackReason(family),
    });
  }
}

export function publicStatusCode(view: PublicJobView): number {
  if (view.status === "queued" || view.status === "processing") {
    return 202;
  }
  return 200;
}

export function readPublicIdempotency(request: Request): string | null {
  return readIdempotencyKey(request);
}

export function mapPublicError(error: unknown) {
  if (error instanceof PublicInputError) {
    return jsonNoStore({ error: error.message, error_code: error.errorCode }, error.status);
  }
  if (error instanceof InsufficientCreditsError) {
    return jsonNoStore({ error: error.message, error_code: error.errorCode }, 402);
  }
  if (error instanceof IdempotencyKeyError) {
    return jsonNoStore({ error: error.message, error_code: error.errorCode }, 400);
  }
  if (error instanceof IdempotencyConflictError) {
    return jsonNoStore({ error: error.message, error_code: error.errorCode }, 409);
  }
  if (error instanceof SourceImageError || error instanceof UnknownConversationError) {
    return jsonNoStore({ error: error.message, error_code: error.errorCode }, 400);
  }
  console.error("public api failed", error instanceof Error ? error.message : "unknown");
  return jsonNoStore({ error: "Could not complete the request", error_code: "INTERNAL" }, 500);
}
