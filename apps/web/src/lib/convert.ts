import { randomUUID } from "node:crypto";
import { convertCredits, LEDGER_REASONS, type ConvertCharge, type RasterDpi, type SvgConvertMode } from "@sci-draw/credits";
import { createConvertProvider, type RasterFormat } from "@sci-draw/providers";
import { getDb } from "@/db";
import { confirmCredits, ensureSignupBonus, InsufficientCreditsError, reserveCreditsTx, rollbackCredits } from "@/lib/credits";
import { persistUserFile, readResultObject, resultKeyForUser } from "@/lib/storage";
import { CONVERT_PURPOSE, readReadyUpload } from "@/lib/uploads";

export class ConvertInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConvertInputError";
  }
}

export type ConvertTarget =
  | { format: "svg"; mode: SvgConvertMode }
  | { format: "pptx" }
  | { format: RasterFormat; dpi: RasterDpi };

function chargeFor(target: ConvertTarget): ConvertCharge {
  switch (target.format) {
    case "svg":
      return { kind: "svg", mode: target.mode };
    case "pptx":
      return { kind: "pptx" };
    case "png":
    case "pdf":
    case "tiff":
      return { kind: "raster", dpi: target.dpi };
    default: {
      const neverTarget: never = target;
      throw new ConvertInputError(`Unsupported format ${String(neverTarget)}`);
    }
  }
}

async function spend<T>(userId: string, cost: number, run: () => Promise<T>): Promise<T> {
  await ensureSignupBonus(userId);
  const refId = randomUUID();
  await getDb().transaction(async (tx) => {
    await reserveCreditsTx(tx, userId, cost, refId, LEDGER_REASONS.convertReserve);
  });
  try {
    const value = await run();
    await confirmCredits(userId, refId, LEDGER_REASONS.convertConsume);
    return value;
  } catch (error) {
    await rollbackCredits(userId, cost, refId, LEDGER_REASONS.convertRollback);
    throw error;
  }
}

export async function convertImageBytes(input: {
  userId: string;
  bytes: Uint8Array;
  mimeType: string;
  target: ConvertTarget;
}): Promise<{ url: string; creditsConsumed: number; extension: string }> {
  if (!input.mimeType.startsWith("image/")) {
    throw new ConvertInputError("Choose a PNG, JPEG, or WebP image");
  }
  const cost = convertCredits(chargeFor(input.target));
  const provider = createConvertProvider({ CONVERT_PROVIDER: process.env.CONVERT_PROVIDER });
  return spend(input.userId, cost, async () => {
    const target = input.target;
    const file = await (async () => {
      switch (target.format) {
        case "svg":
          return provider.toSvg({ bytes: input.bytes, mimeType: input.mimeType, mode: target.mode });
        case "pptx":
          return provider.toPptx({ bytes: input.bytes, mimeType: input.mimeType });
        case "png":
        case "pdf":
        case "tiff":
          return provider.toRaster({ bytes: input.bytes, mimeType: input.mimeType, format: target.format, dpi: target.dpi });
        default: {
          const neverTarget: never = target;
          throw new ConvertInputError(`Unsupported format ${String(neverTarget)}`);
        }
      }
    })();
    const stored = await persistUserFile({
      userId: input.userId,
      bytes: file.bytes,
      mimeType: file.mimeType,
      extension: file.extension,
    });
    return { url: stored.url, creditsConsumed: cost, extension: file.extension };
  });
}

export async function convertImageUrl(input: {
  userId: string;
  imageUrl: string;
  target: ConvertTarget;
}): Promise<{ url: string; creditsConsumed: number; extension: string }> {
  const key = resultKeyForUser(input.imageUrl, input.userId);
  if (!key) {
    throw new ConvertInputError("Image was not found");
  }
  const bytes = await readResultObject(key);
  if (!bytes) {
    throw new ConvertInputError("Image was not found");
  }
  const extension = key.slice(key.lastIndexOf(".") + 1);
  const mimeType = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png";
  return convertImageBytes({ userId: input.userId, bytes, mimeType, target: input.target });
}

export async function convertUpload(input: {
  userId: string;
  objectKey: string;
  target: ConvertTarget;
}): Promise<{ url: string; creditsConsumed: number; extension: string }> {
  let source: { bytes: Uint8Array; mimeType: string };
  try {
    source = await readReadyUpload(input.userId, input.objectKey, CONVERT_PURPOSE);
  } catch {
    throw new ConvertInputError("Upload is not ready");
  }
  return convertImageBytes({
    userId: input.userId,
    bytes: source.bytes,
    mimeType: source.mimeType,
    target: input.target,
  });
}

export { InsufficientCreditsError };
