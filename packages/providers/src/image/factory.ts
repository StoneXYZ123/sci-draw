import { createGeminiImageProvider } from "./gemini";
import { createMockImageProvider } from "./mock";
import type { ImageProvider, ImageProviderId } from "./types";

export type ImageProviderEnv = {
  IMAGE_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_IMAGE_MODEL?: string;
};

const DEFAULT_MODEL = "gemini-3.1-flash-image";

export function resolveImageProviderId(env: ImageProviderEnv): ImageProviderId | "unconfigured" {
  const requested = (env.IMAGE_PROVIDER ?? "gemini").trim().toLowerCase();
  if (requested === "mock") {
    return "mock";
  }
  if (requested === "gemini" || requested === "") {
    return env.GEMINI_API_KEY?.trim() ? "gemini" : "mock";
  }
  return "unconfigured";
}

export function createImageProvider(env: ImageProviderEnv): ImageProvider {
  const id = resolveImageProviderId(env);
  switch (id) {
    case "mock":
      return createMockImageProvider();
    case "gemini":
      return createGeminiImageProvider({
        apiKey: env.GEMINI_API_KEY?.trim() ?? "",
        model: env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_MODEL,
      });
    case "unconfigured": {
      const requested = env.IMAGE_PROVIDER ?? "";
      throw new Error(`Image provider "${requested}" is not available in this release`);
    }
    default: {
      const neverId: never = id;
      throw new Error(`Unhandled image provider ${neverId}`);
    }
  }
}
