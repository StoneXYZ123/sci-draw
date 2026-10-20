import { LEDGER_REASONS, type LedgerReason } from "@sci-draw/credits";

export type CreditFamily = "drawing" | "convert" | "sci_vis";

export function creditFamilyForJob(type: string): CreditFamily | null {
  switch (type) {
    case "generate":
      return "drawing";
    case "public_convert":
    case "convert_vsdx":
      return "convert";
    case "public_chart":
    case "sci_vis":
    case "sci_vis_xlsx":
      return "sci_vis";
    default:
      return null;
  }
}

export function reserveReason(family: CreditFamily): LedgerReason {
  switch (family) {
    case "drawing":
      return LEDGER_REASONS.reserve;
    case "convert":
      return LEDGER_REASONS.convertReserve;
    case "sci_vis":
      return LEDGER_REASONS.sciVisReserve;
    default: {
      const neverFamily: never = family;
      throw new Error(`Unhandled credit family ${neverFamily}`);
    }
  }
}

export function consumeReason(family: CreditFamily): LedgerReason {
  switch (family) {
    case "drawing":
      return LEDGER_REASONS.consume;
    case "convert":
      return LEDGER_REASONS.convertConsume;
    case "sci_vis":
      return LEDGER_REASONS.sciVisConsume;
    default: {
      const neverFamily: never = family;
      throw new Error(`Unhandled credit family ${neverFamily}`);
    }
  }
}

export function rollbackReason(family: CreditFamily): LedgerReason {
  switch (family) {
    case "drawing":
      return LEDGER_REASONS.rollback;
    case "convert":
      return LEDGER_REASONS.convertRollback;
    case "sci_vis":
      return LEDGER_REASONS.sciVisRollback;
    default: {
      const neverFamily: never = family;
      throw new Error(`Unhandled credit family ${neverFamily}`);
    }
  }
}
