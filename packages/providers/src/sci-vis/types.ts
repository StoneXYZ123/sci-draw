import type { SciVisChartType, SciVisJournal, SciVisLayout, SciVisPalette, SciVisWidth } from "@sci-draw/schemas";

export type SciVisSandbox = "local" | "e2b" | "modal";

export type SciVisEngine = "python" | "mock";

export class SciVisEngineError extends Error {
  readonly errorCode: "SANDBOX_TIMEOUT" | "SANDBOX_FAILED" | "SANDBOX_REQUIRED";

  constructor(message: string, errorCode: SciVisEngineError["errorCode"]) {
    super(message);
    this.name = "SciVisEngineError";
    this.errorCode = errorCode;
  }
}

export type ChartRequest = {
  csv: string;
  chartTypes: SciVisChartType[];
  journalStyle: SciVisJournal;
  figureWidth: SciVisWidth;
  colorPalette: SciVisPalette;
  multiChartLayout: SciVisLayout;
  followUpInstruction?: string;
  fileContext?: string;
  currentCode?: string;
  sandbox: SciVisSandbox;
  geminiApiKey?: string;
  geminiModel?: string;
  e2bApiKey?: string;
  modalEndpoint?: string;
  modalTokenId?: string;
  modalTokenSecret?: string;
};

export type ChartArtifact = {
  code: string;
  png: Uint8Array;
  pdf?: Uint8Array;
  engine: SciVisEngine;
  sandbox: SciVisSandbox;
  executed: "template" | "model" | "supplied";
};
