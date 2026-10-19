const BLOCKED = /\b(subprocess|socket|os\.system|eval\(|exec\(|__import__|shutil|urllib|requests|open\s*\(\s*['\"]\/)\b/;

export function pythonFromModelText(text: string): string | null {
  const fenced = text.match(/```(?:python)?\s*([\s\S]*?)```/);
  const code = (fenced?.[1] ?? text).trim();
  if (!code.includes("matplotlib") || code.length > 20_000 || BLOCKED.test(code)) {
    return null;
  }
  if (!code.includes("data.csv") || !code.includes("chart.png")) {
    return null;
  }
  return code;
}

export async function rewriteChartScript(input: {
  apiKey: string;
  model: string;
  template: string;
  followUpInstruction?: string;
  fileContext?: string;
}): Promise<string | null> {
  const prompt = [
    "Rewrite the matplotlib script below so it still reads data.csv and writes chart.png and chart.pdf.",
    "Use matplotlib. Use seaborn only inside a try block.",
    "Do not import os, subprocess, socket, shutil, or network libraries.",
    input.fileContext ? `Context: ${input.fileContext}` : "",
    input.followUpInstruction ? `Change requested: ${input.followUpInstruction}` : "",
    "Return only one python code fence.",
    input.template,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
  return pythonFromModelText(text);
}
