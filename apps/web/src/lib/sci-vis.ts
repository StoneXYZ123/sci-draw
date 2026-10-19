import { randomBytes, randomUUID } from "node:crypto";
import { LEDGER_REASONS, sciVisCredits, type SciVisAction } from "@sci-draw/credits";
import {
  parseTable,
  renderSciVisChart,
  resolveSciVisSandbox,
  SciVisEngineError,
  TableParseError,
  tableToCsv,
  type SciVisSandbox,
} from "@sci-draw/providers";
import type { SciVisChartType, SciVisJournal, SciVisLayout, SciVisPalette, SciVisWidth } from "@sci-draw/schemas";
import { and, eq, sql } from "drizzle-orm";
import { conversation, job, message } from "@/db/schema";
import { getDb } from "@/db";
import { confirmCredits, ensureSignupBonus, InsufficientCreditsError, reserveCreditsTx, rollbackCredits } from "@/lib/credits";
import { claimJobCompleted, claimJobFailed } from "@/lib/job-claim";
import { isUniqueViolation } from "@/lib/pg-error";
import { persistUserFile } from "@/lib/storage";
import { readReadyUpload, SCIVIS_PURPOSE } from "@/lib/uploads";

export class SciVisInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SciVisInputError";
  }
}

export class SciVisConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SciVisConflictError";
  }
}

export type SciVisRequest = {
  requestId?: string;
  objectKey: string;
  filename?: string;
  chartTypes: SciVisChartType[];
  journalStyle: SciVisJournal;
  figureWidth: SciVisWidth;
  colorPalette: SciVisPalette;
  multiChartLayout: SciVisLayout;
  fileContext?: string;
  conversationId?: string;
  followUpInstruction?: string;
  currentCode?: string;
  baseGenerationId?: string;
};

type Prepared = {
  userId: string;
  jobId: string;
  conversationId: string;
  isNew: boolean;
  cost: number;
  action: SciVisAction;
  filename: string;
  csv: string;
  sandbox: SciVisSandbox;
  request: SciVisRequest;
};

function spreadsheet(filename: string, contentType: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith(".xls") ||
    lower.endsWith(".xlsx") ||
    contentType === "application/vnd.ms-excel" ||
    contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

function batchIdFor(requestId: string | undefined, jobId: string): string {
  if (requestId && /^[A-Za-z0-9_-]{6,80}$/.test(requestId)) {
    return `sci-${requestId}`;
  }
  return `sci-${jobId}`;
}

export async function prepareSciVis(userId: string, request: SciVisRequest): Promise<Prepared> {
  await ensureSignupBonus(userId);
  const sandbox = (() => {
    try {
      return resolveSciVisSandbox({
        SCIVIS_SANDBOX: process.env.SCIVIS_SANDBOX,
        E2B_API_KEY: process.env.E2B_API_KEY,
        MODAL_TOKEN_ID: process.env.MODAL_TOKEN_ID,
        MODAL_TOKEN_SECRET: process.env.MODAL_TOKEN_SECRET,
        SCIVIS_MODAL_ENDPOINT: process.env.SCIVIS_MODAL_ENDPOINT,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        SCIVIS_LLM_MODEL: process.env.SCIVIS_LLM_MODEL,
      });
    } catch (error) {
      throw new SciVisInputError(error instanceof Error ? error.message : "SciVis sandbox is not available in this release");
    }
  })();
  if (sandbox === "e2b" && !process.env.E2B_API_KEY?.trim()) {
    throw new SciVisInputError("E2B_API_KEY is required for the E2B sandbox");
  }
  if (sandbox === "modal" && !(process.env.MODAL_TOKEN_ID?.trim() && process.env.MODAL_TOKEN_SECRET?.trim() && process.env.SCIVIS_MODAL_ENDPOINT?.trim())) {
    throw new SciVisInputError("Modal needs MODAL_TOKEN_ID, MODAL_TOKEN_SECRET, and SCIVIS_MODAL_ENDPOINT");
  }
  let source: { bytes: Uint8Array; mimeType: string };
  try {
    source = await readReadyUpload(userId, request.objectKey, SCIVIS_PURPOSE);
  } catch {
    throw new SciVisInputError("Upload is not ready");
  }
  const filename = request.filename?.trim() || request.objectKey.split("/").pop() || "table.csv";
  if (spreadsheet(filename, source.mimeType)) {
    throw new SciVisInputError("This release plots CSV, TSV, and TXT. The spreadsheet is stored and was not charted.");
  }
  let csv = "";
  try {
    const table = parseTable(new TextDecoder("utf-8", { fatal: false }).decode(source.bytes), filename);
    csv = tableToCsv(table);
  } catch (error) {
    if (error instanceof TableParseError) {
      throw new SciVisInputError(error.message);
    }
    throw new SciVisInputError("The table could not be read");
  }
  const db = getDb();
  let conversationId = request.conversationId;
  let isNew = false;
  if (conversationId) {
    const [existing] = await db
      .select({ id: conversation.id })
      .from(conversation)
      .where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId), eq(conversation.product, "sci_vis")))
      .limit(1);
    if (!existing) {
      throw new SciVisInputError("Conversation was not found");
    }
  } else {
    conversationId = randomUUID();
    isNew = true;
  }
  const followUp = Boolean(request.followUpInstruction || request.currentCode || request.baseGenerationId);
  const action: SciVisAction = followUp ? "follow-up" : "generate";
  const cost = sciVisCredits(action);
  const jobId = randomBytes(32).toString("hex");
  try {
    await db.transaction(async (tx) => {
      await reserveCreditsTx(tx, userId, cost, jobId, LEDGER_REASONS.sciVisReserve);
      await tx.insert(job).values({
        id: jobId,
        userId,
        type: "sci_vis",
        status: "running",
        request: {
          objectKey: request.objectKey,
          filename,
          chartTypes: request.chartTypes,
          journalStyle: request.journalStyle,
          figureWidth: request.figureWidth,
          colorPalette: request.colorPalette,
          multiChartLayout: request.multiChartLayout,
          conversationId,
          baseGenerationId: request.baseGenerationId,
          action,
        },
        creditsReserved: cost,
        creditsConsumed: 0,
        batchId: batchIdFor(request.requestId, jobId),
      });
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      throw error;
    }
    if (isUniqueViolation(error)) {
      throw new SciVisConflictError("This request was already submitted");
    }
    throw error;
  }
  return { userId, jobId, conversationId, isNew, cost, action, filename, csv, sandbox, request };
}

async function remember(prepared: Prepared, imageUrl: string, code: string, metadata: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    if (prepared.isNew) {
      await tx.insert(conversation).values({
        id: prepared.conversationId,
        userId: prepared.userId,
        product: "sci_vis",
        mode: prepared.request.chartTypes[0] ?? "line",
        title: prepared.filename.slice(0, 80),
        initialPrompt: prepared.request.followUpInstruction ?? prepared.filename,
        previewImageUrl: imageUrl,
        messageCount: 2,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await tx
        .update(conversation)
        .set({
          previewImageUrl: imageUrl,
          messageCount: sql`${conversation.messageCount} + 2`,
          updatedAt: now,
        })
        .where(eq(conversation.id, prepared.conversationId));
    }
    await tx.insert(message).values([
      {
        id: randomUUID(),
        conversationId: prepared.conversationId,
        role: "user",
        content: prepared.request.followUpInstruction || prepared.filename,
        contentType: "text",
        metadata: JSON.stringify({ objectKey: prepared.request.objectKey, filename: prepared.filename }),
        createdAt: now,
      },
      {
        id: randomUUID(),
        conversationId: prepared.conversationId,
        role: "assistant",
        content: code,
        contentType: "text",
        metadata: JSON.stringify(metadata),
        createdAt: now,
      },
    ]);
  });
}

export function sciVisSseResponse(prepared: Prepared): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      let confirmed = false;
      try {
        send({ type: "status", status: "started" });
        send({
          type: "session_ready",
          sessionId: prepared.conversationId,
          conversationId: prepared.conversationId,
          generationId: prepared.jobId,
        });
        send({ type: "progress", percent: 25, message: "Reading the table" });
        const chart = await renderSciVisChart({
          csv: prepared.csv,
          chartTypes: prepared.request.chartTypes,
          journalStyle: prepared.request.journalStyle,
          figureWidth: prepared.request.figureWidth,
          colorPalette: prepared.request.colorPalette,
          multiChartLayout: prepared.request.multiChartLayout,
          followUpInstruction: prepared.request.followUpInstruction,
          fileContext: prepared.request.fileContext,
          currentCode: prepared.request.currentCode,
          sandbox: prepared.sandbox,
          geminiApiKey: process.env.GEMINI_API_KEY,
          geminiModel: process.env.SCIVIS_LLM_MODEL,
          e2bApiKey: process.env.E2B_API_KEY,
          modalEndpoint: process.env.SCIVIS_MODAL_ENDPOINT,
          modalTokenId: process.env.MODAL_TOKEN_ID,
          modalTokenSecret: process.env.MODAL_TOKEN_SECRET,
        });
        send({ type: "preview", message: "Drafting the chart", code: chart.code.slice(0, 500) });
        send({ type: "progress", percent: 80, message: "Saving the chart" });
        const png = await persistUserFile({
          userId: prepared.userId,
          bytes: chart.png,
          mimeType: "image/png",
          extension: "png",
        });
        const formats: Record<string, string> = { png: png.url };
        if (chart.pdf && chart.pdf.byteLength > 0) {
          const pdf = await persistUserFile({
            userId: prepared.userId,
            bytes: chart.pdf,
            mimeType: "application/pdf",
            extension: "pdf",
          });
          formats.pdf = pdf.url;
        }
        const chartState = {
          chartTypes: prepared.request.chartTypes,
          journalStyle: prepared.request.journalStyle,
          figureWidth: prepared.request.figureWidth,
          colorPalette: prepared.request.colorPalette,
          multiChartLayout: prepared.request.multiChartLayout,
          sandbox: chart.sandbox,
          executed: chart.executed,
          baseGenerationId: prepared.request.baseGenerationId,
        };
        await remember(prepared, png.url, chart.code, {
          imageUrl: png.url,
          code: chart.code,
          engine: chart.engine,
          formats,
          creditsConsumed: prepared.cost,
          chartState,
        });
        const completed = await claimJobCompleted(prepared.jobId, {
          result: { imageUrl: png.url, engine: chart.engine, formats, creditsConsumed: prepared.cost },
          creditsConsumed: prepared.cost,
        });
        if (!completed) {
          send({ type: "failed", error: "Could not chart the table", errorCode: "SCIVIS_FAILED" });
          return;
        }
        await confirmCredits(prepared.userId, prepared.jobId, LEDGER_REASONS.sciVisConsume);
        confirmed = true;
        send({
          type: "result",
          imageUrl: png.url,
          code: chart.code,
          engine: chart.engine,
          formats,
          creditsConsumed: prepared.cost,
          chartState,
          conversationId: prepared.conversationId,
          generationId: prepared.jobId,
        });
        send({ type: "complete" });
      } catch (error) {
        const errorCode = error instanceof SciVisEngineError ? error.errorCode : "SCIVIS_FAILED";
        const message = error instanceof SciVisEngineError ? error.message : "Could not chart the table";
        if (!confirmed) {
          const claimed = await claimJobFailed(prepared.jobId, {
            errorCode,
            errorMessage: message.slice(0, 300),
          }).catch(() => undefined);
          if (claimed) {
            await rollbackCredits(prepared.userId, prepared.cost, prepared.jobId, LEDGER_REASONS.sciVisRollback).catch(
              () => undefined,
            );
          }
        }
        console.error("sci-vis stream failed", error instanceof Error ? error.message : "unknown");
        send({ type: "failed", error: message, errorCode });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

export { InsufficientCreditsError };
