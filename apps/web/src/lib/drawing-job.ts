import { randomUUID } from "node:crypto";
import { aiDrawingCredits } from "@sci-draw/credits";
import { createImageProvider, type ImageGenerateInput } from "@sci-draw/providers";
import { parseGenerateBody, type CompletedDrawingResult, type DrawingGenerateBody, type DrawingMessage, type FailedDrawingResult } from "@sci-draw/schemas";
import { and, eq, sql } from "drizzle-orm";
import { conversation, job, message, uploadObject } from "@/db/schema";
import { getDb } from "@/db";
import { confirmCredits, ensureSignupBonus, InsufficientCreditsError, reserveCreditsTx, rollbackCredits } from "@/lib/credits";
import { buildModelPrompt } from "@/lib/figure-hints";
import { persistGeneratedImage } from "@/lib/storage";
import { readReadySource, SOURCE_PURPOSE } from "@/lib/uploads";

const STALE_MS = 6 * 60 * 1000;

type JobRow = typeof job.$inferSelect;

function taskId(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

export async function createDrawingJob(userId: string, body: DrawingGenerateBody): Promise<JobRow> {
  await ensureSignupBonus(userId);
  const db = getDb();
  const cost = aiDrawingCredits(body.resolution, body.batchCount);
  const id = taskId();
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(job)
        .where(and(eq(job.userId, userId), eq(job.batchId, body.batchId)))
        .limit(1);
      if (existing) {
        return existing;
      }
      if (body.conversationId) {
        const [owned] = await tx
          .select({ id: conversation.id })
          .from(conversation)
          .where(and(eq(conversation.id, body.conversationId), eq(conversation.userId, userId)))
          .limit(1);
        if (!owned) {
          throw new UnknownConversationError();
        }
      }
      if (body.mode === "sketch" || body.mode === "replicate") {
        const [source] = await tx
          .select({ id: uploadObject.id })
          .from(uploadObject)
          .where(
            and(
              eq(uploadObject.objectKey, body.uploadedImageObjectKey),
              eq(uploadObject.userId, userId),
              eq(uploadObject.purpose, SOURCE_PURPOSE),
              eq(uploadObject.status, "ready"),
            ),
          )
          .limit(1);
        if (!source) {
          throw new SourceImageError();
        }
      }
      await tx.insert(job).values({
        id,
        userId,
        type: "generate",
        status: "pending",
        request: body,
        creditsReserved: cost,
        creditsConsumed: 0,
        batchId: body.batchId,
      });
      await reserveCreditsTx(tx, userId, cost, id);
      const [created] = await tx.select().from(job).where(eq(job.id, id)).limit(1);
      if (!created) {
        throw new Error("Job insert failed");
      }
      return created;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const [existing] = await db.select().from(job).where(and(eq(job.userId, userId), eq(job.batchId, body.batchId))).limit(1);
    if (!existing) {
      throw error;
    }
    return existing;
  }
}

function userFacingText(body: DrawingGenerateBody): string {
  switch (body.mode) {
    case "prompt":
      return body.prompt;
    case "sketch":
    case "replicate":
      return body.supplementaryPrompt;
    default: {
      const neverBody: never = body;
      throw new Error(`Unhandled mode ${String(neverBody)}`);
    }
  }
}

function userMetadata(body: DrawingGenerateBody): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    templateId: body.templateId,
    styleId: body.styleId,
    aspectRatio: body.aspectRatio,
    mode: body.mode,
    resolution: body.resolution,
    batchId: body.batchId,
    batchCount: body.batchCount,
  };
  if (body.mode === "sketch" || body.mode === "replicate") {
    metadata.uploadedImageObjectKey = body.uploadedImageObjectKey;
  }
  return metadata;
}

function messageMetadata(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

async function failJob(row: JobRow, error: unknown): Promise<void> {
  const messageText = error instanceof Error ? error.message.slice(0, 300) : "Image generation failed";
  const result: FailedDrawingResult = {
    success: false,
    errorCode: "GENERATION_FAILED",
    error: messageText,
  };
  await rollbackCredits(row.userId, row.creditsReserved, row.id);
  await getDb()
    .update(job)
    .set({
      status: "failed",
      result,
      errorCode: result.errorCode,
      errorMessage: messageText,
      creditsConsumed: 0,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(job.id, row.id));
}

export async function processDrawingJob(jobId: string): Promise<void> {
  const db = getDb();
  const claimed = await db
    .update(job)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(job.id, jobId), eq(job.status, "pending")))
    .returning();
  const row = claimed[0];
  if (!row) {
    return;
  }
  try {
    const body = parseGenerateBody(row.request);
    const provider = createImageProvider({
      IMAGE_PROVIDER: process.env.IMAGE_PROVIDER,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_IMAGE_MODEL: process.env.GEMINI_IMAGE_MODEL,
    });
    const text = userFacingText(body);
    let referenceImage: ImageGenerateInput["referenceImage"] = undefined;
    if (body.mode === "sketch" || body.mode === "replicate") {
      referenceImage = await readReadySource(row.userId, body.uploadedImageObjectKey);
    }
    const unit = aiDrawingCredits(body.resolution, 1);
    const images: Array<{ url: string; format: string; width: number; height: number; batchIndex: number }> = [];
    for (let batchIndex = 0; batchIndex < body.batchCount; batchIndex += 1) {
      const image = await provider.generate({
        prompt: buildModelPrompt({
          mode: body.mode,
          text,
          templateId: body.templateId,
          styleId: body.styleId,
          batchIndex,
          batchCount: body.batchCount,
        }),
        aspectRatio: body.aspectRatio,
        resolution: body.resolution,
        referenceImage,
      });
      const stored = await persistGeneratedImage({
        userId: row.userId,
        bytes: image.bytes,
        mimeType: image.mimeType,
      });
      images.push({
        url: stored.url,
        format: stored.format,
        width: image.width,
        height: image.height,
        batchIndex,
      });
    }
    const completedAt = new Date();
    const result = await db.transaction(async (tx) => {
      let conversationId = body.conversationId;
      let isNewConversation = false;
      if (!conversationId) {
        conversationId = randomUUID();
        isNewConversation = true;
        await tx.insert(conversation).values({
          id: conversationId,
          userId: row.userId,
          product: "ai_drawing",
          mode: body.mode,
          title: text.slice(0, 80),
          initialPrompt: text,
          previewImageUrl: images[0]?.url,
          messageCount: 0,
        });
      }
      const userMessageId = randomUUID();
      const createdAt = completedAt.toISOString();
      const userMessage: DrawingMessage = {
        id: userMessageId,
        role: "user",
        content: text,
        contentType: "text",
        conversationId,
        createdAt,
        metadata: messageMetadata(userMetadata(body)),
      };
      await tx.insert(message).values({
        id: userMessage.id,
        conversationId,
        role: userMessage.role,
        content: userMessage.content,
        contentType: userMessage.contentType,
        metadata: userMessage.metadata,
        createdAt: completedAt,
      });
      const results = [];
      for (const image of images) {
        const assistant: DrawingMessage = {
          id: randomUUID(),
          role: "assistant",
          content: "",
          contentType: "image",
          conversationId,
          createdAt,
          metadata: messageMetadata({
            imageUrl: image.url,
            creditsConsumed: unit,
            resolution: body.resolution,
            width: image.width,
            height: image.height,
            format: image.format,
            batchId: body.batchId,
            batchCount: body.batchCount,
            batchIndex: image.batchIndex,
            completedAt: createdAt,
          }),
        };
        await tx.insert(message).values({
          id: assistant.id,
          conversationId,
          role: assistant.role,
          content: assistant.content,
          contentType: assistant.contentType,
          metadata: assistant.metadata,
          createdAt: new Date(completedAt.getTime() + image.batchIndex + 1),
        });
        results.push({
          batchId: body.batchId,
          batchIndex: image.batchIndex,
          success: true as const,
          imageUrl: image.url,
          completedAt: createdAt,
          creditsConsumed: unit,
          assistantMessage: assistant,
        });
      }
      await tx
        .update(conversation)
        .set({
          previewImageUrl: images[0]?.url,
          messageCount: sql`${conversation.messageCount} + ${1 + results.length}`,
          updatedAt: completedAt,
        })
        .where(eq(conversation.id, conversationId));
      const payload: CompletedDrawingResult = {
        success: true,
        data: {
          conversationId,
          isNewConversation,
          successCount: results.length,
          failureCount: 0,
          totalCreditsConsumed: unit * results.length,
          userMessage,
          results,
        },
      };
      return payload;
    });
    await confirmCredits(row.userId, row.id);
    await db
      .update(job)
      .set({
        status: "completed",
        result,
        creditsConsumed: result.data.totalCreditsConsumed,
        updatedAt: new Date(),
        completedAt,
      })
      .where(eq(job.id, row.id));
  } catch (error) {
    await failJob(row, error);
  }
}

export async function recoverIfStale(row: JobRow): Promise<JobRow> {
  if (row.status !== "running" || !row.updatedAt) {
    return row;
  }
  if (Date.now() - row.updatedAt.getTime() < STALE_MS) {
    return row;
  }
  await failJob(row, new Error("Generation timed out"));
  const [fresh] = await getDb().select().from(job).where(eq(job.id, row.id)).limit(1);
  return fresh ?? row;
}

export class SourceImageError extends Error {
  readonly errorCode = "SOURCE_IMAGE_NOT_READY" as const;

  constructor() {
    super("Source image is not ready");
    this.name = "SourceImageError";
  }
}

export class UnknownConversationError extends Error {
  readonly errorCode = "UNKNOWN_CONVERSATION" as const;

  constructor() {
    super("Unknown conversation");
    this.name = "UnknownConversationError";
  }
}

export { InsufficientCreditsError };
