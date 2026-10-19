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

export const LEDGER_REASONS = {
  signupBonus: "signup_bonus",
  reserve: "ai_drawing.reserve",
  consume: "ai_drawing.consume",
  rollback: "ai_drawing.rollback",
} as const;

export type LedgerReason = (typeof LEDGER_REASONS)[keyof typeof LEDGER_REASONS];
