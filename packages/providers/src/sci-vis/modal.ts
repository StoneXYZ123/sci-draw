import { SciVisEngineError } from "./types";

type ModalPayload = {
  pngBase64?: string;
  pdfBase64?: string;
  error?: string;
};

export async function runModalPython(input: {
  endpoint: string;
  tokenId: string;
  tokenSecret: string;
  code: string;
  csv: string;
}): Promise<{ png: Uint8Array; pdf?: Uint8Array }> {
  let response: Response;
  try {
    response = await fetch(input.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "modal-key": input.tokenId,
        "modal-secret": input.tokenSecret,
      },
      body: JSON.stringify({ code: input.code, csv: input.csv, filename: "data.csv" }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Modal sandbox failed";
    const code = error instanceof Error && error.name === "TimeoutError" ? "SANDBOX_TIMEOUT" : "SANDBOX_FAILED";
    throw new SciVisEngineError(message.slice(0, 300), code);
  }
  const payload = (await response.json().catch(() => ({}))) as ModalPayload;
  if (!response.ok || !payload.pngBase64) {
    throw new SciVisEngineError((payload.error || "Modal sandbox failed").slice(0, 300), "SANDBOX_FAILED");
  }
  const png = Buffer.from(payload.pngBase64, "base64");
  const pdf = payload.pdfBase64 ? Buffer.from(payload.pdfBase64, "base64") : undefined;
  return { png, pdf };
}
