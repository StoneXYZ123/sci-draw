import { logicalImageSize } from "./dimensions";
import { encodeDiagramPng } from "./png";
import type { GeneratedImage, ImageGenerateInput, ImageProvider } from "./types";

const MAX_EDGE = 960;

function previewSize(aspectRatio: string, resolution: ImageGenerateInput["resolution"]): { width: number; height: number } {
  const logical = logicalImageSize(aspectRatio, resolution);
  const longest = Math.max(logical.width, logical.height);
  const scale = Math.min(1, MAX_EDGE / longest);
  return {
    width: Math.max(64, Math.round(logical.width * scale)),
    height: Math.max(64, Math.round(logical.height * scale)),
  };
}

export function createMockImageProvider(): ImageProvider {
  return {
    id: "mock",
    async generate(input: ImageGenerateInput): Promise<GeneratedImage> {
      const size = previewSize(input.aspectRatio, input.resolution);
      const label = `${input.resolution} ${input.aspectRatio}`;
      const bytes = encodeDiagramPng({ ...size, label: `${label} ${input.prompt}` });
      return {
        bytes,
        mimeType: "image/png",
        width: size.width,
        height: size.height,
      };
    },
  };
}
