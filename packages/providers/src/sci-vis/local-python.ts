import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SciVisEngineError } from "./types";

export type LocalPythonResult =
  | { kind: "ok"; png: Uint8Array; pdf?: Uint8Array }
  | { kind: "missing-runtime" };

function missingRuntime(stderr: string): boolean {
  return /No module named ['"]matplotlib['"]/.test(stderr) || /ENOENT/.test(stderr) || /python3: not found/.test(stderr);
}

export async function runLocalPython(code: string, csv: string, timeoutMs = 20_000): Promise<LocalPythonResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "sci-vis-"));
  try {
    await writeFile(path.join(dir, "data.csv"), csv, "utf8");
    await writeFile(path.join(dir, "chart.py"), code, "utf8");
    const outcome = await new Promise<{ status: number | null; stderr: string; timedOut: boolean }>((resolve) => {
      let stderr = "";
      let timedOut = false;
      const child = spawn("python3", ["chart.py"], {
        cwd: dir,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: dir,
          TMPDIR: dir,
          MPLBACKEND: "Agg",
          PYTHONNOUSERSITE: "1",
          PYTHONDONTWRITEBYTECODE: "1",
          NODE_ENV: process.env.NODE_ENV,
        },
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout.on("data", () => undefined);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < 4_000) {
          stderr += chunk;
        }
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ status: null, stderr: error.message, timedOut: false });
      });
      child.on("close", (status) => {
        clearTimeout(timer);
        resolve({ status, stderr, timedOut });
      });
    });
    if (outcome.timedOut) {
      throw new SciVisEngineError("The chart sandbox timed out", "SANDBOX_TIMEOUT");
    }
    if (outcome.status !== 0) {
      if (missingRuntime(outcome.stderr)) {
        return { kind: "missing-runtime" };
      }
      throw new SciVisEngineError("The chart script failed", "SANDBOX_FAILED");
    }
    const png = await readFile(path.join(dir, "chart.png"));
    let pdf: Uint8Array | undefined;
    try {
      pdf = await readFile(path.join(dir, "chart.pdf"));
    } catch {
      pdf = undefined;
    }
    return { kind: "ok", png, pdf };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
