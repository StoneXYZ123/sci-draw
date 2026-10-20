"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SciVisChartType, SciVisJournal, SciVisLayout, SciVisPalette, SciVisWidth } from "@sci-draw/schemas";

type MeResponse = {
  user: { id: string; email: string; name: string; creditsBalance: number } | null;
};

type Locale = "en" | "zh";

type ResultEvent = {
  imageUrl: string;
  code: string;
  engine: string;
  formats: Record<string, string>;
  creditsConsumed: number;
  conversationId: string;
  generationId: string;
};

const COPY = {
  en: {
    title: "Chart a table",
    lead: "Upload a CSV, TSV, or TXT table. This page returns Python and a chart. XLSX and XLS can be stored; plotting them is not in this release. A finished chart can be exported as an editable spreadsheet for 10 credits.",
    credits: "Credits",
    file: "Table",
    chart: "Chart",
    journal: "Journal style",
    palette: "Palette",
    width: "Width",
    layout: "Layout",
    cost: "Cost",
    run: "Chart",
    working: "Charting",
    signIn: "Sign in to chart",
    follow: "Follow-up",
    followPlaceholder: "Use a log axis and keep the labels",
    update: "Update the chart",
    code: "Python",
    download: "Download",
    export: "Export spreadsheet",
    progress: "Working",
    choose: "Choose a table",
    large: "File must be 5 MB or smaller",
    failed: "Could not chart the table",
  },
  zh: {
    title: "用表格画图",
    lead: "上传 CSV、TSV 或 TXT。页面会返回 Python 和一张图。XLSX 与 XLS 可以先存起来，这一版不拿它们作图。画完可以花 10 积分导出可编辑表格。",
    credits: "积分",
    file: "表格",
    chart: "图型",
    journal: "期刊样式",
    palette: "配色",
    width: "宽度",
    layout: "排版",
    cost: "消耗",
    run: "作图",
    working: "正在作图",
    signIn: "登录后作图",
    follow: "接着改",
    followPlaceholder: "改成对数轴，并保留标签",
    update: "按说明重画",
    code: "Python",
    download: "下载",
    export: "导出表格",
    progress: "进行中",
    choose: "请选择表格",
    large: "文件不能超过 5 MB",
    failed: "没能画出这张图",
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function contentTypeFor(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    return "text/csv";
  }
  if (name.endsWith(".tsv")) {
    return "text/tab-separated-values";
  }
  if (name.endsWith(".txt")) {
    return "text/plain";
  }
  if (name.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (name.endsWith(".xls")) {
    return "application/vnd.ms-excel";
  }
  return file.type || "application/octet-stream";
}

async function uploadTable(file: File): Promise<string> {
  const contentType = contentTypeFor(file);
  const presignResponse = await fetch("/api/sci-vis/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "presign", filename: file.name, contentType, size: file.size }),
  });
  const presign: unknown = await presignResponse.json();
  if (!presignResponse.ok || !isRecord(presign) || typeof presign.uploadUrl !== "string" || typeof presign.objectKey !== "string") {
    const message = isRecord(presign) && typeof presign.error === "string" ? presign.error : "Upload failed";
    throw new Error(message);
  }
  const headers = isRecord(presign.headers) ? presign.headers : {};
  const signedType = typeof headers["content-type"] === "string" ? headers["content-type"] : contentType;
  const putResponse = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "content-type": signedType },
    body: file,
  });
  if (!putResponse.ok) {
    throw new Error("Upload failed");
  }
  const completeResponse = await fetch("/api/sci-vis/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "complete", objectKey: presign.objectKey }),
  });
  const completed: unknown = await completeResponse.json();
  if (!completeResponse.ok) {
    const message = isRecord(completed) && typeof completed.error === "string" ? completed.error : "Upload failed";
    throw new Error(message);
  }
  return presign.objectKey;
}

async function readSse(response: Response, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Could not chart the table");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((item) => item.startsWith("data: "));
      if (!line) {
        continue;
      }
      const payload: unknown = JSON.parse(line.slice(6));
      if (isRecord(payload)) {
        onEvent(payload);
      }
    }
  }
}

export function SciVisBench({
  locale,
  chartTypes,
  journals,
  palettes,
  widths,
  layouts,
}: {
  locale: Locale;
  chartTypes: readonly SciVisChartType[];
  journals: readonly SciVisJournal[];
  palettes: readonly SciVisPalette[];
  widths: readonly SciVisWidth[];
  layouts: readonly SciVisLayout[];
}) {
  const text = COPY[locale];
  const [me, setMe] = useState<MeResponse["user"] | undefined>(undefined);
  const [file, setFile] = useState<File | null>(null);
  const [objectKey, setObjectKey] = useState<string | null>(null);
  const [chart, setChart] = useState<SciVisChartType>(chartTypes[0] ?? "line");
  const [journal, setJournal] = useState<SciVisJournal>("none");
  const [palette, setPalette] = useState<SciVisPalette>("default");
  const [width, setWidth] = useState<SciVisWidth>("single");
  const [layout, setLayout] = useState<SciVisLayout>("single");
  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ResultEvent | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      const body = (await response.json()) as MeResponse;
      setMe(body.user);
    })();
  }, []);

  async function chartTable(instruction?: string) {
    setError(null);
    setProgress(null);
    if (!file && !objectKey) {
      setError(text.choose);
      return;
    }
    if (file && file.size > 5 * 1024 * 1024) {
      setError(text.large);
      return;
    }
    setBusy(true);
    try {
      const key = objectKey ?? (file ? await uploadTable(file) : "");
      if (!key) {
        throw new Error(text.choose);
      }
      setObjectKey(key);
      const response = await fetch("/api/sci-vis/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: { objectKey: key, filename: file?.name },
          chartTypes: [chart],
          journalStyle: journal,
          colorPalette: palette,
          figureWidth: width,
          multiChartLayout: layout,
          conversationId: result?.conversationId,
          baseGenerationId: instruction ? result?.generationId : undefined,
          followUpInstruction: instruction || undefined,
        }),
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
        const body: unknown = await response.json().catch(() => null);
        const message = isRecord(body) && typeof body.error === "string" ? body.error : text.failed;
        throw new Error(message);
      }
      let next: ResultEvent | null = null;
      let failed: string | null = null;
      await readSse(response, (event) => {
        if (event.type === "progress" && typeof event.message === "string") {
          setProgress(event.message);
        }
        if (event.type === "failed" && typeof event.error === "string") {
          failed = event.error;
        }
        if (event.type === "result" && typeof event.imageUrl === "string" && typeof event.code === "string") {
          const formats = isRecord(event.formats) ? Object.fromEntries(Object.entries(event.formats).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : { png: event.imageUrl };
          next = {
            imageUrl: event.imageUrl,
            code: event.code,
            engine: typeof event.engine === "string" ? event.engine : "mock",
            formats,
            creditsConsumed: typeof event.creditsConsumed === "number" ? event.creditsConsumed : 10,
            conversationId: typeof event.conversationId === "string" ? event.conversationId : "",
            generationId: typeof event.generationId === "string" ? event.generationId : "",
          };
        }
      });
      if (failed) {
        throw new Error(failed);
      }
      if (!next) {
        throw new Error(text.failed);
      }
      setResult(next);
      setProgress(null);
      const meResponse = await fetch("/api/me", { cache: "no-store" });
      const meBody = (await meResponse.json()) as MeResponse;
      setMe(meBody.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : text.failed);
    } finally {
      setBusy(false);
    }
  }

  async function exportSheet() {
    if (!result?.generationId) {
      return;
    }
    setError(null);
    const response = await fetch("/api/sci-vis/export-xlsx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generationId: result.generationId }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(body) || typeof body.xlsxUrl !== "string") {
      const message = isRecord(body) && typeof body.error === "string" ? body.error : text.failed;
      setError(message);
      return;
    }
    setExportUrl(body.xlsxUrl);
    const meResponse = await fetch("/api/me", { cache: "no-store" });
    const meBody = (await meResponse.json()) as MeResponse;
    setMe(meBody.user);
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">{text.title}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{text.lead}</p>
        </div>
        <p className="text-sm">
          {text.credits}: {me ? me.creditsBalance : "—"}
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void chartTable();
        }}
        className="space-y-4 border border-[var(--line)] bg-white/70 p-4"
      >
        <label className="block space-y-1 text-sm">
          <span>{text.file}</span>
          <input
            required={!objectKey}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/plain"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setObjectKey(null);
              setResult(null);
            }}
            className="block w-full text-sm"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span>{text.chart}</span>
            <select value={chart} onChange={(event) => setChart(event.target.value as SciVisChartType)} className="w-full border border-[var(--line)] bg-white px-2 py-2">
              {chartTypes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{text.journal}</span>
            <select value={journal} onChange={(event) => setJournal(event.target.value as SciVisJournal)} className="w-full border border-[var(--line)] bg-white px-2 py-2">
              {journals.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{text.palette}</span>
            <select value={palette} onChange={(event) => setPalette(event.target.value as SciVisPalette)} className="w-full border border-[var(--line)] bg-white px-2 py-2">
              {palettes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{text.width}</span>
            <select value={width} onChange={(event) => setWidth(event.target.value as SciVisWidth)} className="w-full border border-[var(--line)] bg-white px-2 py-2">
              {widths.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{text.layout}</span>
            <select value={layout} onChange={(event) => setLayout(event.target.value as SciVisLayout)} className="w-full border border-[var(--line)] bg-white px-2 py-2">
              {layouts.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-sm text-[var(--muted)]">
          {text.cost}: 10
        </p>
        {me === undefined ? null : me ? (
          <button type="submit" disabled={busy} className="bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-ink)] disabled:opacity-60">
            {busy ? text.working : text.run}
          </button>
        ) : (
          <Link href={`/sign-in?next=${encodeURIComponent(locale === "zh" ? "/zh/sci-vis" : "/sci-vis")}`} className="inline-block bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper)]">
            {text.signIn}
          </Link>
        )}
        {progress ? (
          <p className="text-sm text-[var(--muted)]">
            {text.progress}: {progress}
          </p>
        ) : null}
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </form>
      {result ? (
        <div className="space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.imageUrl} alt={text.title} className="w-full border border-[var(--line)] bg-white" />
          <p className="flex flex-wrap gap-2 text-sm">
            {Object.entries(result.formats).map(([format, url]) => (
              <a key={format} href={`/api/download-image?url=${encodeURIComponent(url)}`} className="border border-[var(--line)] bg-white px-3 py-2">
                {text.download} {format} · {result.engine} · {result.creditsConsumed}
              </a>
            ))}
            <button type="button" onClick={() => void exportSheet()} className="border border-[var(--line)] bg-white px-3 py-2">
              {text.export}
            </button>
            {exportUrl ? (
              <a href={`/api/download-image?url=${encodeURIComponent(exportUrl)}`} className="border border-[var(--line)] bg-white px-3 py-2">
                {text.download} xlsx
              </a>
            ) : null}
          </p>
          <label className="block space-y-1 text-sm">
            <span>{text.follow}</span>
            <textarea
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
              placeholder={text.followPlaceholder}
              rows={3}
              className="w-full border border-[var(--line)] bg-white px-3 py-2"
            />
          </label>
          <button type="button" disabled={busy || followUp.trim().length === 0} onClick={() => void chartTable(followUp.trim())} className="border border-[var(--line)] bg-white px-4 py-2 text-sm disabled:opacity-60">
            {text.update}
          </button>
          <div>
            <h2 className="text-sm">{text.code}</h2>
            <pre className="mt-2 max-h-80 overflow-auto border border-[var(--line)] bg-white p-3 text-xs">{result.code}</pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
