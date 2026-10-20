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

export const BATCH_COUNTS = [1, 2, 3, 4, 8] as const;

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
    z.literal(3),
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

export type ReferenceGenerateBody = GenerateBody & {
  mode: "sketch" | "replicate";
  supplementaryPrompt: string;
  uploadedImageObjectKey: string;
};

export type DrawingGenerateBody = PromptGenerateBody | ReferenceGenerateBody;

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

function withoutTemporaryConversation(body: GenerateBody): GenerateBody {
  if (!body.conversationId?.startsWith("temp-")) {
    return body;
  }
  const { conversationId: _ignored, ...rest } = body;
  return rest;
}

export function parseGenerateBody(input: unknown): DrawingGenerateBody {
  const parsed = generateBodySchema.safeParse(input);
  if (!parsed.success) {
    throw new GenerateBodyError("Invalid request", "INVALID_REQUEST", parsed.error.flatten());
  }
  const body = withoutTemporaryConversation(parsed.data);
  switch (body.mode) {
    case "custom":
      throw new GenerateBodyError("Custom mode is not available in this release", "MODE_NOT_AVAILABLE");
    case "prompt": {
      if (!body.prompt) {
        throw new GenerateBodyError("prompt is required", "PROMPT_REQUIRED");
      }
      return { ...body, mode: "prompt", prompt: body.prompt };
    }
    case "sketch":
    case "replicate": {
      if (!body.supplementaryPrompt) {
        throw new GenerateBodyError("supplementaryPrompt is required", "PROMPT_REQUIRED");
      }
      if (!body.uploadedImageObjectKey) {
        throw new GenerateBodyError("uploadedImageObjectKey is required", "INVALID_REQUEST");
      }
      return {
        ...body,
        mode: body.mode,
        supplementaryPrompt: body.supplementaryPrompt,
        uploadedImageObjectKey: body.uploadedImageObjectKey,
      };
    }
    default: {
      const neverMode: never = body.mode;
      throw new GenerateBodyError(`Unknown mode ${neverMode}`, "INVALID_REQUEST");
    }
  }
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

export const SCI_VIS_CHART_TYPES = [
  "line",
  "bar",
  "scatter",
  "box",
  "histogram",
  "heatmap",
  "violin",
  "volcano",
  "survival",
  "dose-response",
] as const;

export const SCI_VIS_JOURNALS = ["none", "nature", "cell", "science", "lancet"] as const;
export const SCI_VIS_PALETTES = ["default", "colorblind", "sequential", "diverging", "greyscale"] as const;
export const SCI_VIS_WIDTHS = ["single", "medium", "double"] as const;
export const SCI_VIS_LAYOUTS = ["single", "row", "grid"] as const;

export type SciVisChartType = (typeof SCI_VIS_CHART_TYPES)[number];
export type SciVisJournal = (typeof SCI_VIS_JOURNALS)[number];
export type SciVisPalette = (typeof SCI_VIS_PALETTES)[number];
export type SciVisWidth = (typeof SCI_VIS_WIDTHS)[number];
export type SciVisLayout = (typeof SCI_VIS_LAYOUTS)[number];

export type DrawingTaskResponse =
  | { id: string; status: "pending" | "running" }
  | { id: string; status: "completed"; result: CompletedDrawingResult }
  | { id: string; status: "failed"; result: FailedDrawingResult };
