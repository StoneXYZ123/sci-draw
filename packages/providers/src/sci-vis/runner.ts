import { encodeDiagramPng } from "../image/png";
import { runE2bPython } from "./e2b";
import { rewriteChartScript } from "./llm";
import { runLocalPython } from "./local-python";
import { runModalPython } from "./modal";
import { buildChartScript } from "./script";
import { type ChartArtifact, type ChartRequest, type SciVisSandbox, SciVisEngineError } from "./types";

export type SciVisEnv = {
  SCIVIS_SANDBOX?: string;
  E2B_API_KEY?: string;
  MODAL_TOKEN_ID?: string;
  MODAL_TOKEN_SECRET?: string;
  SCIVIS_MODAL_ENDPOINT?: string;
  GEMINI_API_KEY?: string;
  SCIVIS_LLM_MODEL?: string;
};

export function resolveSciVisSandbox(env: SciVisEnv): SciVisSandbox {
  const explicit = env.SCIVIS_SANDBOX?.trim().toLowerCase() ?? "";
  if (explicit === "local" || explicit === "e2b" || explicit === "modal") {
    return explicit;
  }
  if (explicit) {
    throw new Error("SciVis sandbox is not available in this release");
  }
  if (env.E2B_API_KEY?.trim()) {
    return "e2b";
  }
  if (env.MODAL_TOKEN_ID?.trim() && env.MODAL_TOKEN_SECRET?.trim() && env.SCIVIS_MODAL_ENDPOINT?.trim()) {
    return "modal";
  }
  return "local";
}

function placeholder(chart: string): Uint8Array {
  return encodeDiagramPng({ width: 960, height: 640, label: chart });
}

function suppliedCode(code: string): string {
  const trimmed = code.trim();
  if (trimmed.length < 1 || trimmed.length > 20_000) {
    throw new SciVisEngineError("The supplied script is empty or too long", "SANDBOX_FAILED");
  }
  if (!trimmed.includes("matplotlib") || !trimmed.includes("data.csv") || !trimmed.includes("chart.png")) {
    throw new SciVisEngineError("The supplied script must read data.csv and write chart.png with matplotlib", "SANDBOX_FAILED");
  }
  if (/\b(subprocess|socket|os\.system|eval\(|exec\(|__import__|shutil|urllib|requests)\b/.test(trimmed)) {
    throw new SciVisEngineError("The supplied script uses a blocked module", "SANDBOX_FAILED");
  }
  return trimmed;
}

export async function renderSciVisChart(input: ChartRequest): Promise<ChartArtifact> {
  if (input.currentCode?.trim() && input.sandbox === "local") {
    throw new SciVisEngineError("Supplied Python runs only inside E2B or Modal. Nothing was executed.", "SANDBOX_REQUIRED");
  }
  const template = buildChartScript(input);
  let code = template;
  let executed: ChartArtifact["executed"] = "template";
  if (input.currentCode?.trim() && input.sandbox !== "local") {
    code = suppliedCode(input.currentCode);
    executed = "supplied";
  } else if (input.sandbox !== "local" && input.geminiApiKey?.trim()) {
    const rewritten = await rewriteChartScript({
      apiKey: input.geminiApiKey.trim(),
      model: input.geminiModel?.trim() || "gemini-2.0-flash",
      template,
      followUpInstruction: input.followUpInstruction,
      fileContext: input.fileContext,
    });
    if (rewritten) {
      code = rewritten;
      executed = "model";
    }
  }

  if (input.sandbox === "e2b") {
    const apiKey = input.e2bApiKey?.trim() ?? "";
    if (!apiKey) {
      throw new SciVisEngineError("E2B_API_KEY is empty", "SANDBOX_FAILED");
    }
    const remote = await runE2bPython({ apiKey, code, csv: input.csv });
    return { code, png: remote.png, pdf: remote.pdf, engine: "python", sandbox: "e2b", executed };
  }
  if (input.sandbox === "modal") {
    const endpoint = input.modalEndpoint?.trim() ?? "";
    const tokenId = input.modalTokenId?.trim() ?? "";
    const tokenSecret = input.modalTokenSecret?.trim() ?? "";
    if (!endpoint || !tokenId || !tokenSecret) {
      throw new SciVisEngineError("Modal sandbox settings are incomplete", "SANDBOX_FAILED");
    }
    const remote = await runModalPython({ endpoint, tokenId, tokenSecret, code, csv: input.csv });
    return { code, png: remote.png, pdf: remote.pdf, engine: "python", sandbox: "modal", executed };
  }

  const local = await runLocalPython(code, input.csv);
  if (local.kind === "missing-runtime") {
    return { code, png: placeholder(input.chartTypes[0] ?? "line"), engine: "mock", sandbox: "local", executed };
  }
  return { code, png: local.png, pdf: local.pdf, engine: "python", sandbox: "local", executed };
}
