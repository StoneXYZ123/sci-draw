import { PDFDocument } from "pdf-lib";
import { posterize } from "potrace";
import PptxGenJS from "pptxgenjs";
import sharp from "sharp";
import type { ConvertedFile, ConvertImageInput, ConvertProvider, RasterDpi, RasterFormat, SvgConvertMode } from "./types";

const MAX_EDGE = 4096;

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes);
}

async function imageSize(bytes: Uint8Array): Promise<{ width: number; height: number; density: number }> {
  const metadata = await sharp(asBuffer(bytes)).metadata();
  return {
    width: metadata.width && metadata.width > 0 ? metadata.width : 640,
    height: metadata.height && metadata.height > 0 ? metadata.height : 480,
    density: metadata.density && metadata.density > 0 ? metadata.density : 96,
  };
}

function textOnlySvg(width: number, height: number): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#f3efe4"/>',
    '<text x="16" y="36" font-family="sans-serif" font-size="20" fill="#1c2a2e">Text layer</text>',
    '<text x="16" y="68" font-family="sans-serif" font-size="14" fill="#5c6b70">No text engine is configured for this release.</text>',
    "</svg>",
  ].join("");
}

function traceSvg(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    posterize(asBuffer(bytes), { steps: 3 }, (error, svg) => {
      if (error) {
        reject(error);
        return;
      }
      if (!svg.includes("<svg") || /<script/i.test(svg)) {
        reject(new Error("Tracer did not return a usable SVG"));
        return;
      }
      resolve(svg);
    });
  });
}

async function svgFile(input: ConvertImageInput & { mode: SvgConvertMode }): Promise<ConvertedFile> {
  const size = await imageSize(input.bytes);
  const svg = input.mode === "text-only" ? textOnlySvg(size.width, size.height) : await traceSvg(input.bytes);
  return {
    bytes: Buffer.from(svg, "utf8"),
    mimeType: "image/svg+xml",
    extension: "svg",
  };
}

async function pngAtDpi(bytes: Uint8Array, dpi: RasterDpi): Promise<Buffer> {
  const size = await imageSize(bytes);
  const scale = dpi / size.density;
  let width = Math.max(1, Math.round(size.width * scale));
  let height = Math.max(1, Math.round(size.height * scale));
  const longest = Math.max(width, height);
  if (longest > MAX_EDGE) {
    const clamp = MAX_EDGE / longest;
    width = Math.max(1, Math.round(width * clamp));
    height = Math.max(1, Math.round(height * clamp));
  }
  return sharp(asBuffer(bytes)).resize(width, height, { fit: "fill" }).png().withMetadata({ density: dpi }).toBuffer();
}

async function rasterFile(input: ConvertImageInput & { format: RasterFormat; dpi: RasterDpi }): Promise<ConvertedFile> {
  const png = await pngAtDpi(input.bytes, input.dpi);
  switch (input.format) {
    case "png":
      return { bytes: png, mimeType: "image/png", extension: "png" };
    case "tiff": {
      const tiff = await sharp(png).withMetadata({ density: input.dpi }).tiff({ compression: "lzw" }).toBuffer();
      return { bytes: tiff, mimeType: "image/tiff", extension: "tiff" };
    }
    case "pdf": {
      const pdf = await PDFDocument.create();
      const image = await pdf.embedPng(png);
      const page = pdf.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      return { bytes: Buffer.from(await pdf.save()), mimeType: "application/pdf", extension: "pdf" };
    }
    default: {
      const neverFormat: never = input.format;
      throw new Error(`Unhandled raster format ${neverFormat}`);
    }
  }
}

async function pptxFile(input: ConvertImageInput): Promise<ConvertedFile> {
  const png = await sharp(asBuffer(input.bytes)).png().toBuffer();
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "FIGURE", width: 13.333, height: 7.5 });
  pptx.layout = "FIGURE";
  const slide = pptx.addSlide();
  slide.addImage({
    data: `image/png;base64,${png.toString("base64")}`,
    x: 0.4,
    y: 0.35,
    w: 12.5,
    h: 6.8,
  });
  const output = await pptx.write({ outputType: "nodebuffer" });
  const bytes = output instanceof Uint8Array ? output : Buffer.from(String(output));
  return {
    bytes,
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: "pptx",
  };
}

export function createOpenSourceConvertProvider(): ConvertProvider {
  return {
    id: "opensource",
    toSvg: svgFile,
    toPptx: pptxFile,
    toRaster: rasterFile,
  };
}
