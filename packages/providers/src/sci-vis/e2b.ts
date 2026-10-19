import { Sandbox } from "@e2b/code-interpreter";
import { SciVisEngineError } from "./types";

export async function runE2bPython(input: { apiKey: string; code: string; csv: string }): Promise<{ png: Uint8Array; pdf?: Uint8Array }> {
  const sandbox = await Sandbox.create({ apiKey: input.apiKey, timeoutMs: 60_000 });
  try {
    await sandbox.files.write("/home/user/data.csv", input.csv);
    const context = await sandbox.createCodeContext({ cwd: "/home/user", language: "python" });
    const execution = await sandbox.runCode(input.code, { context, timeoutMs: 20_000 });
    if (execution.error) {
      throw new SciVisEngineError(execution.error.value.slice(0, 300) || "The chart script failed", "SANDBOX_FAILED");
    }
    const png = await sandbox.files.read("/home/user/chart.png", { format: "bytes" });
    let pdf: Uint8Array | undefined;
    try {
      pdf = await sandbox.files.read("/home/user/chart.pdf", { format: "bytes" });
    } catch {
      pdf = undefined;
    }
    return { png, pdf };
  } catch (error) {
    if (error instanceof SciVisEngineError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "E2B sandbox failed";
    const code = /timeout/i.test(message) ? "SANDBOX_TIMEOUT" : "SANDBOX_FAILED";
    throw new SciVisEngineError(message.slice(0, 300), code);
  } finally {
    await sandbox.kill().catch(() => undefined);
  }
}
