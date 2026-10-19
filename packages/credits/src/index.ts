export const AI_DRAWING_UNIT_CREDITS = {
  "2K": 5,
  "4K": 10,
} as const;

export type DrawingResolution = keyof typeof AI_DRAWING_UNIT_CREDITS;

export function aiDrawingCredits(resolution: DrawingResolution, batchCount: number): number {
  if (!Number.isInteger(batchCount) || batchCount < 1) {
    throw new Error("batchCount must be a positive integer");
  }
  return AI_DRAWING_UNIT_CREDITS[resolution] * batchCount;
}

export const CONVERT_CREDITS = {
  svgTextOnly: 10,
  svgFull: 15,
  pptx: 10,
  vsdx: 20,
  dpi300: 5,
  dpi600: 10,
  dpi1000: 15,
} as const;

export type SvgConvertMode = "text-only" | "full";
export type RasterDpi = 300 | 600 | 1000;

export type ConvertCharge =
  | { kind: "svg"; mode: SvgConvertMode }
  | { kind: "pptx" }
  | { kind: "vsdx" }
  | { kind: "raster"; dpi: RasterDpi };

export function convertCredits(charge: ConvertCharge): number {
  switch (charge.kind) {
    case "svg":
      return charge.mode === "text-only" ? CONVERT_CREDITS.svgTextOnly : CONVERT_CREDITS.svgFull;
    case "pptx":
      return CONVERT_CREDITS.pptx;
    case "vsdx":
      return CONVERT_CREDITS.vsdx;
    case "raster":
      switch (charge.dpi) {
        case 300:
          return CONVERT_CREDITS.dpi300;
        case 600:
          return CONVERT_CREDITS.dpi600;
        case 1000:
          return CONVERT_CREDITS.dpi1000;
        default: {
          const neverDpi: never = charge.dpi;
          throw new Error(`Unhandled dpi ${neverDpi}`);
        }
      }
    default: {
      const neverCharge: never = charge;
      throw new Error(`Unhandled convert charge ${String(neverCharge)}`);
    }
  }
}

export const LEDGER_REASONS = {
  signupBonus: "signup_bonus",
  reserve: "ai_drawing.reserve",
  consume: "ai_drawing.consume",
  rollback: "ai_drawing.rollback",
  convertReserve: "convert.reserve",
  convertConsume: "convert.consume",
  convertRollback: "convert.rollback",
} as const;

export type LedgerReason = (typeof LEDGER_REASONS)[keyof typeof LEDGER_REASONS];
