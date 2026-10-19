export type ImageResolution = "2K" | "4K";

export type ImageGenerateInput = {
  prompt: string;
  aspectRatio: string;
  resolution: ImageResolution;
  referenceImage?: {
    bytes: Uint8Array;
    mimeType: string;
  };
};

export type GeneratedImage = {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
};

export type ImageProviderId = "gemini" | "mock";

export interface ImageProvider {
  readonly id: ImageProviderId;
  generate(input: ImageGenerateInput): Promise<GeneratedImage>;
}
