import { readImageSize } from "./dimensions";
import type { GeneratedImage, ImageGenerateInput, ImageProvider } from "./types";

type GeminiPart = {
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mimeType?: string; mime_type?: string; data?: string };
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  error?: { message?: string };
};

function generationConfig(model: string, input: ImageGenerateInput): Record<string, unknown> {
  if (model.includes("2.5-flash-image")) {
    return {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: input.aspectRatio },
    };
  }
  return {
    responseModalities: ["IMAGE"],
    responseFormat: {
      image: {
        aspectRatio: input.aspectRatio,
        imageSize: input.resolution,
      },
    },
  };
}

function readInlineImage(part: GeminiPart): { mimeType: string; bytes: Buffer } | null {
  const inline = part.inlineData ?? part.inline_data;
  if (!inline?.data) {
    return null;
  }
  const mimeType = inline.mimeType ?? part.inline_data?.mime_type ?? "image/png";
  return { mimeType, bytes: Buffer.from(inline.data, "base64") };
}

export function createGeminiImageProvider(options: { apiKey: string; model: string }): ImageProvider {
  const { apiKey, model } = options;
  return {
    id: "gemini",
    async generate(input: ImageGenerateInput): Promise<GeneratedImage> {
      const prompt = [
        "Draw one scientific figure for a research article.",
        "Use a clear layout and legible labels. Do not add watermarks, logos, or a brand name.",
        "Description:",
        input.prompt,
      ].join("\n");
      const body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: generationConfig(model, input),
      };
      let response: Response | null = null;
      let lastError = "Gemini image request failed";
      for (const version of ["v1beta", "v1"]) {
        response = await fetch(
          `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120_000),
          },
        );
        if (response.status !== 404) {
          break;
        }
        lastError = `Model ${model} was not found`;
      }
      if (!response) {
        throw new Error(lastError);
      }
      const payload = (await response.json()) as GeminiResponse;
      if (!response.ok) {
        const message = payload.error?.message ?? response.statusText;
        throw new Error(message.slice(0, 300));
      }
      const parts = payload.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        const image = readInlineImage(part);
        if (!image) {
          continue;
        }
        const size = readImageSize(image.bytes) ?? { width: 0, height: 0 };
        return {
          bytes: image.bytes,
          mimeType: image.mimeType,
          width: size.width,
          height: size.height,
        };
      }
      throw new Error("Gemini response did not include an image");
    },
  };
}
