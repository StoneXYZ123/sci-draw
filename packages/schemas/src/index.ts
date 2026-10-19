import { z } from "zod";

export const ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
] as const;

export const RESOLUTIONS = ["2K", "4K"] as const;

export const BATCH_COUNTS = [1, 2, 4, 8] as const;

export const DRAWING_MODES = ["prompt", "sketch", "replicate", "custom"] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export type Resolution = (typeof RESOLUTIONS)[number];
export type BatchCount = (typeof BATCH_COUNTS)[number];
export type DrawingMode = (typeof DRAWING_MODES)[number];

export const capabilitiesSchema = z.object({
  aspectRatios: z.array(z.enum(ASPECT_RATIOS)),
  resolutions: z.array(z.enum(RESOLUTIONS)),
});

export const generateBodySchema = z.object({
  prompt: z.string().trim().min(1).max(4000).optional(),
  supplementaryPrompt: z.string().trim().max(4000).optional(),
  uploadedImageObjectKey: z.string().trim().min(1).max(512).optional(),
  templateId: z.string().trim().min(1).max(64).default("none"),
  styleId: z.string().trim().min(1).max(64).default("none"),
  aspectRatio: z.enum(ASPECT_RATIOS).default("4:3"),
  resolution: z.enum(RESOLUTIONS).default("2K"),
  batchCount: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(4),
    z.literal(8),
  ]).default(1),
  batchId: z.string().trim().min(1).max(128),
  conversationId: z.string().trim().min(1).max(128).optional(),
  mode: z.enum(DRAWING_MODES).default("prompt"),
  textLanguage: z.string().trim().min(2).max(16).default("en"),
});

export type GenerateBody = z.infer<typeof generateBodySchema>;

export type PromptGenerateBody = GenerateBody & {
  mode: "prompt";
  prompt: string;
};

export class GenerateBodyError extends Error {
  constructor(
    message: string,
    readonly errorCode: "INVALID_REQUEST" | "MODE_NOT_AVAILABLE" | "PROMPT_REQUIRED",
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "GenerateBodyError";
  }
}

export function parseGenerateBody(input: unknown): PromptGenerateBody {
  const parsed = generateBodySchema.safeParse(input);
  if (!parsed.success) {
    throw new GenerateBodyError("Invalid request", "INVALID_REQUEST", parsed.error.flatten());
  }
  const body = parsed.data;
  if (body.mode !== "prompt") {
    throw new GenerateBodyError(
      "Only prompt mode is available in this release",
      "MODE_NOT_AVAILABLE",
    );
  }
  if (!body.prompt) {
    throw new GenerateBodyError("prompt is required", "PROMPT_REQUIRED");
  }
  if (body.conversationId?.startsWith("temp-")) {
    const { conversationId: _ignored, ...rest } = body;
    return { ...rest, mode: "prompt", prompt: body.prompt };
  }
  return { ...body, mode: "prompt", prompt: body.prompt };
}

export type DrawingMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  contentType: "text" | "image" | "file";
  conversationId: string;
  createdAt: string;
  metadata: string;
};

export type DrawingResultItem = {
  batchId: string;
  batchIndex: number;
  success: true;
  imageUrl: string;
  completedAt: string;
  creditsConsumed: number;
  assistantMessage: DrawingMessage;
};

export type CompletedDrawingResult = {
  success: true;
  data: {
    conversationId: string;
    isNewConversation: boolean;
    successCount: number;
    failureCount: number;
    totalCreditsConsumed: number;
    userMessage: DrawingMessage;
    results: DrawingResultItem[];
  };
};

export type FailedDrawingResult = {
  success: false;
  errorCode: string;
  error: string;
};

export type DrawingTaskResponse =
  | { id: string; status: "pending" | "running" }
  | { id: string; status: "completed"; result: CompletedDrawingResult }
  | { id: string; status: "failed"; result: FailedDrawingResult };
