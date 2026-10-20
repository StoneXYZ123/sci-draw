import { randomBytes } from "node:crypto";
import { sciVisCredits } from "@sci-draw/credits";
import { parseTable, TableParseError } from "@sci-draw/providers";
import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { job } from "@/db/schema";
import { getDb } from "@/db";
import { creditFamilyForJob, consumeReason, reserveReason, rollbackReason } from "@/lib/credit-family";
import { InsufficientCreditsError } from "@/lib/credits";
import { beginUserJob, claimRunning, finishJobFailure, finishJobSuccess, readJob } from "@/lib/job-start";
import { scopedBatchId } from "@/lib/idempotency";
import { persistUserFile } from "@/lib/storage";
import { readReadyUpload, SCIVIS_PURPOSE } from "@/lib/uploads";

export class ExportRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "ExportRequestError";
  }
}

type ChartMeta = {
  chartTypes: string;
  journalStyle: string;
  figureWidth: string;
  colorPalette: string;
  multiChartLayout: string;
  engine: string;
  imageUrl: string;
  filename: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string").join(", ");
  }
  return "";
}

export async function buildSciVisWorkbook(input: { csvText: string; filename: string; meta: ChartMeta }): Promise<Uint8Array> {
  let table;
  try {
    table = parseTable(input.csvText, input.filename);
  } catch (error) {
    if (error instanceof TableParseError) {
      throw new ExportRequestError(error.message, 400);
    }
    throw new ExportRequestError("The table could not be read", 400);
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "sci-draw";
  const data = workbook.addWorksheet("data");
  data.addRow(table.headers);
  for (const row of table.rows) {
    data.addRow(row);
  }
  data.getRow(1).font = { bold: true };
  const chart = workbook.addWorksheet("chart");
  chart.addRow(["field", "value"]);
  chart.getRow(1).font = { bold: true };
  const fields: Array<[string, string]> = [
    ["source_filename", input.meta.filename],
    ["chart_types", input.meta.chartTypes],
    ["journal_style", input.meta.journalStyle],
    ["figure_width", input.meta.figureWidth],
    ["color_palette", input.meta.colorPalette],
    ["multi_chart_layout", input.meta.multiChartLayout],
    ["engine", input.meta.engine],
    ["image_url", input.meta.imageUrl],
  ];
  for (const [field, value] of fields) {
    chart.addRow([field, value]);
  }
  const raw = await workbook.xlsx.writeBuffer();
  return new Uint8Array(raw);
}

function storedExport(row: typeof job.$inferSelect): { xlsxUrl: string; creditsConsumed: number } | null {
  const result = asRecord(row.result);
  const files = Array.isArray(result.files) ? result.files : [];
  for (const file of files) {
    const record = asRecord(file);
    if (record.format === "xlsx" && typeof record.url === "string") {
      return { xlsxUrl: record.url, creditsConsumed: row.creditsConsumed || sciVisCredits("xlsx") };
    }
  }
  if (typeof result.xlsxUrl === "string") {
    return { xlsxUrl: result.xlsxUrl, creditsConsumed: row.creditsConsumed || sciVisCredits("xlsx") };
  }
  return null;
}

export async function exportSciVisXlsx(input: {
  userId: string;
  generationId: string;
  idempotencyKey: string | null;
}): Promise<{ xlsxUrl: string; creditsConsumed: number }> {
  const db = getDb();
  const [generation] = await db
    .select()
    .from(job)
    .where(and(eq(job.id, input.generationId), eq(job.userId, input.userId), eq(job.type, "sci_vis")))
    .limit(1);
  if (!generation) {
    throw new ExportRequestError("Chart was not found", 404);
  }
  if (generation.status !== "completed") {
    throw new ExportRequestError("Chart is not ready to export", 409, "CHART_NOT_READY");
  }
  const request = asRecord(generation.request);
  const result = asRecord(generation.result);
  const objectKey = textField(request, "objectKey");
  const filename = textField(request, "filename") || "table.csv";
  if (!objectKey) {
    throw new ExportRequestError("Chart source is missing", 409, "SOURCE_MISSING");
  }
  let source: { bytes: Uint8Array };
  try {
    source = await readReadyUpload(input.userId, objectKey, SCIVIS_PURPOSE);
  } catch {
    throw new ExportRequestError("Chart source is no longer available", 409, "SOURCE_MISSING");
  }
  const family = creditFamilyForJob("sci_vis_xlsx");
  if (family !== "sci_vis") {
    throw new ExportRequestError("Could not export the spreadsheet", 500);
  }
  const cost = sciVisCredits("xlsx");
  const batchId = input.idempotencyKey
    ? scopedBatchId("xlsx", input.userId, input.idempotencyKey)
    : `xlsx-${randomBytes(16).toString("hex")}`;
  const inputHash = input.idempotencyKey ? input.generationId : batchId;
  let started;
  try {
    started = await beginUserJob({
      userId: input.userId,
      type: "sci_vis_xlsx",
      batchId,
      credits: cost,
      reserveReason: reserveReason(family),
      request: { generationId: input.generationId, inputHash },
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      throw error;
    }
    throw error;
  }
  if (started.row.status === "completed") {
    const existing = storedExport(started.row);
    if (existing) {
      return existing;
    }
  }
  if (started.row.status === "failed") {
    throw new ExportRequestError(started.row.errorMessage ?? "Spreadsheet export failed", 409, started.row.errorCode ?? "EXPORT_FAILED");
  }
  const running = started.row.status === "running" ? started.row : await claimRunning(started.row.id, "sci_vis_xlsx");
  if (!running) {
    const fresh = await readJob(started.row.id);
    const existing = fresh ? storedExport(fresh) : null;
    if (fresh?.status === "completed" && existing) {
      return existing;
    }
    throw new ExportRequestError("Spreadsheet export is already running", 409, "EXPORT_IN_PROGRESS");
  }
  try {
    const csvText = new TextDecoder("utf-8", { fatal: false }).decode(source.bytes);
    const bytes = await buildSciVisWorkbook({
      csvText,
      filename,
      meta: {
        filename,
        chartTypes: textField(request, "chartTypes"),
        journalStyle: textField(request, "journalStyle"),
        figureWidth: textField(request, "figureWidth"),
        colorPalette: textField(request, "colorPalette"),
        multiChartLayout: textField(request, "multiChartLayout"),
        engine: textField(result, "engine"),
        imageUrl: textField(result, "imageUrl"),
      },
    });
    const stored = await persistUserFile({
      userId: input.userId,
      bytes,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: "xlsx",
    });
    const payload = {
      xlsxUrl: stored.url,
      creditsConsumed: cost,
      files: [{ url: stored.url, format: "xlsx" }],
    };
    const won = await finishJobSuccess({
      jobId: running.id,
      userId: input.userId,
      result: payload,
      creditsConsumed: cost,
      consumeReason: consumeReason(family),
    });
    if (!won) {
      const fresh = await readJob(running.id);
      const existing = fresh ? storedExport(fresh) : null;
      if (existing) {
        return existing;
      }
      throw new ExportRequestError("Spreadsheet export failed", 500, "EXPORT_FAILED");
    }
    return { xlsxUrl: stored.url, creditsConsumed: cost };
  } catch (error) {
    if (error instanceof ExportRequestError && error.status < 500) {
      await finishJobFailure({
        jobId: running.id,
        cost,
        errorCode: error.errorCode ?? "EXPORT_FAILED",
        errorMessage: error.message,
        rollbackReason: rollbackReason(family),
      });
      throw error;
    }
    const message = error instanceof Error ? error.message : "Spreadsheet export failed";
    await finishJobFailure({
      jobId: running.id,
      cost,
      errorCode: "EXPORT_FAILED",
      errorMessage: message,
      rollbackReason: rollbackReason(family),
    });
    if (error instanceof ExportRequestError) {
      throw error;
    }
    throw new ExportRequestError("Could not export the spreadsheet", 500, "EXPORT_FAILED");
  }
}
