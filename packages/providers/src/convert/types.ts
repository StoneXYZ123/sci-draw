export type SvgConvertMode = "text-only" | "full";
export type RasterFormat = "png" | "pdf" | "tiff";
export type RasterDpi = 300 | 600 | 1000;

export type ConvertImageInput = {
  bytes: Uint8Array;
  mimeType: string;
};

export type ConvertedFile = {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
};

export interface ConvertProvider {
  readonly id: "opensource";
  toSvg(input: ConvertImageInput & { mode: SvgConvertMode }): Promise<ConvertedFile>;
  toPptx(input: ConvertImageInput): Promise<ConvertedFile>;
  toRaster(input: ConvertImageInput & { format: RasterFormat; dpi: RasterDpi }): Promise<ConvertedFile>;
}
