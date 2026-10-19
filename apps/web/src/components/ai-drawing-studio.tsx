"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteConversationAction } from "@/app/ai-drawing/actions";

type Locale = "en" | "zh";
type Mode = "prompt" | "sketch" | "replicate";
type BatchCount = 1 | 2;

type MeResponse = {
  user: { id: string; email: string; name: string; creditsBalance: number } | null;
};

type ConversationItem = {
  id: string;
  mode: string;
  title: string;
  initialPrompt: string | null;
  createdAt: string;
  updatedAt: string;
  previewImageUrl: string | null;
  messageCount: number;
};

type ThreadMessage = {
  id: string;
  role: string;
  content: string;
  contentType: string;
  metadata: string | null;
};

type TaskResult = {
  success?: boolean;
  error?: string;
  data?: {
    conversationId?: string;
    totalCreditsConsumed?: number;
  };
};

const TEMPLATES = [
  ["none", "None", "无"],
  ["toc-abstract", "Graphical abstract", "图文摘要"],
  ["journal-cover", "Cover figure", "封面图"],
  ["experimental-workflow", "Workflow", "实验流程"],
  ["mechanism-illustration", "Mechanism", "机制"],
  ["signaling-pathway", "Pathway", "通路"],
  ["system-architecture", "Architecture", "系统结构"],
  ["comparison-analysis", "Comparison", "对照"],
] as const;

const STYLES = [
  ["none", "None", "无"],
  ["flat-illustration", "Flat", "扁平"],
  ["isometric-3d", "Isometric", "等轴"],
  ["photorealistic", "Photographic", "照片感"],
  ["schematic-diagram", "Schematic", "示意"],
  ["artistic-abstract", "Abstract", "抽象"],
  ["scientific-illustration", "Textbook", "教科书"],
] as const;

const copy = {
  en: {
    title: "Figure studio",
    lead: "Prompt a figure, or upload a sketch or reference and describe what should change.",
    modes: { prompt: "Prompt", sketch: "Sketch", replicate: "Replicate" },
    prompt: "Prompt",
    note: "Note",
    source: "Source image",
    template: "Template",
    style: "Style",
    resolution: "Resolution",
    count: "Count",
    aspect: "Aspect",
    generate: "Generate",
    signIn: "Sign in to generate",
    credits: "Credits",
    failed: "Drawing failed",
    result: "Result",
    history: "Figures",
    emptyHistory: "Finished figures stay in this list.",
    newFigure: "New figure",
    delete: "Delete",
    confirmDelete: "Confirm",
    cost: "Cost",
    pendingNote: "Queued",
    stages: ["Reading the request", "Arranging the figure", "Drawing", "Saving the result"],
    placeholders: {
      prompt: "A labeled cross-section of a leaf, with the vein system called out",
      sketch: "Keep the boxes, and label each step",
      replicate: "Redraw this as a cleaner textbook figure",
    },
    fileHint: "PNG, JPEG, or WebP, up to 5 MB",
    fileMissing: "Choose a source image",
    fileLarge: "Image must be 5 MB or smaller",
    convert: "Convert",
    svgText: "SVG text · 10",
    svgFull: "SVG paths · 15",
    pptx: "PPTX · 10",
    download: "Download",
  },
  zh: {
    title: "插图工作台",
    lead: "用提示词出图，或上传草图、参考图并写明要改的地方。",
    modes: { prompt: "提示词", sketch: "草图", replicate: "复刻" },
    prompt: "提示词",
    note: "补充说明",
    source: "源图",
    template: "模板",
    style: "风格",
    resolution: "分辨率",
    count: "张数",
    aspect: "比例",
    generate: "生成",
    signIn: "登录后生成",
    credits: "积分",
    failed: "绘制失败",
    result: "结果",
    history: "历史",
    emptyHistory: "完成后的图会出现在这里。",
    newFigure: "新图",
    delete: "删除",
    confirmDelete: "确认",
    cost: "消耗",
    pendingNote: "已排队",
    stages: ["正在阅读请求", "正在安排版面", "正在绘制", "正在保存"],
    placeholders: {
      prompt: "叶片横切面，标出叶脉",
      sketch: "保留方框，并为每一步加标签",
      replicate: "按教科书插图重画这张图",
    },
    fileHint: "PNG、JPEG 或 WebP，最大 5 MB",
    fileMissing: "请选择源图",
    fileLarge: "图片不能超过 5 MB",
    convert: "转换",
    svgText: "SVG 文字 · 10",
    svgFull: "SVG 路径 · 15",
    pptx: "PPTX · 10",
    download: "下载",
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function imageUrlFromMetadata(metadata: string | null): string | null {
  if (!metadata) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (isRecord(parsed) && typeof parsed.imageUrl === "string") {
      return parsed.imageUrl;
    }
  } catch {
    return null;
  }
  return null;
}

function contentTypeFor(file: File): string {
  if (file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp") {
    return file.type;
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) {
    return "image/png";
  }
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (name.endsWith(".webp")) {
    return "image/webp";
  }
  return file.type;
}

async function uploadSource(file: File): Promise<string> {
  const contentType = contentTypeFor(file);
  const presignResponse = await fetch("/api/storage/direct-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "presign",
      purpose: "ai-drawing-source",
      filename: file.name,
      contentType,
      size: file.size,
    }),
  });
  const presign: unknown = await presignResponse.json();
  if (!presignResponse.ok || !isRecord(presign) || typeof presign.uploadUrl !== "string" || typeof presign.objectKey !== "string") {
    const message = isRecord(presign) && typeof presign.error === "string" ? presign.error : "Upload failed";
    throw new Error(message);
  }
  const headers = isRecord(presign.headers) ? presign.headers : { "content-type": contentType };
  const signedType = typeof headers["content-type"] === "string" ? headers["content-type"] : contentType;
  const putResponse = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "content-type": signedType },
    body: file,
  });
  if (!putResponse.ok) {
    throw new Error("Upload failed");
  }
  const completeResponse = await fetch("/api/storage/direct-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "complete",
      purpose: "ai-drawing-source",
      objectKey: presign.objectKey,
    }),
  });
  const completed: unknown = await completeResponse.json();
  if (!completeResponse.ok) {
    const message = isRecord(completed) && typeof completed.error === "string" ? completed.error : "Upload failed";
    throw new Error(message);
  }
  return presign.objectKey;
}

export function AiDrawingStudio({ locale, initialMode }: { locale: Locale; initialMode: Mode }) {
  const text = copy[locale];
  const router = useRouter();
  const basePath = locale === "zh" ? "/zh/ai-drawing" : "/ai-drawing";
  const signInHref = `/sign-in?next=${encodeURIComponent(basePath)}`;
  const labelIndex = locale === "zh" ? 2 : 1;
  const [mode, setMode] = useState<Mode>(initialMode);
  const [prompt, setPrompt] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [templateId, setTemplateId] = useState("none");
  const [styleId, setStyleId] = useState("none");
  const [batchCount, setBatchCount] = useState<BatchCount>(1);
  const [me, setMe] = useState<MeResponse["user"] | undefined>(undefined);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "pending" | "completed" | "failed">("idle");
  const [stageIndex, setStageIndex] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spent, setSpent] = useState<number | null>(null);
  const [downloads, setDownloads] = useState<Record<string, string>>({});
  const [convertBusy, setConvertBusy] = useState<string | null>(null);

  async function refreshMe() {
    const response = await fetch("/api/me", { cache: "no-store" });
    const body = (await response.json()) as MeResponse;
    setMe(body.user);
  }

  async function refreshList() {
    const response = await fetch("/api/ai-drawing/conversations?limit=20&offset=0", { cache: "no-store" });
    if (!response.ok) {
      setConversations([]);
      return;
    }
    const body: unknown = await response.json();
    if (isRecord(body) && Array.isArray(body.conversations)) {
      setConversations(body.conversations as ConversationItem[]);
    }
  }

  async function loadDetail(id: string) {
    const response = await fetch(`/api/ai-drawing/conversations/${id}`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.messages)) {
      return;
    }
    setSelectedId(id);
    setMessages(body.messages as ThreadMessage[]);
  }

  useEffect(() => {
    void refreshMe();
  }, []);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (!me) {
      return;
    }
    void refreshList();
  }, [me]);

  useEffect(() => {
    if (phase !== "pending") {
      return;
    }
    const timer = setInterval(() => {
      setStageIndex((current) => (current + 1) % text.stages.length);
    }, 2500);
    return () => clearInterval(timer);
  }, [phase, text.stages.length]);

  function chooseMode(next: Mode) {
    setMode(next);
    setError(null);
    router.replace(next === "prompt" ? basePath : `${basePath}?mode=${next}`, { scroll: false });
  }

  function startNew() {
    setSelectedId(null);
    setMessages([]);
    setDraft(null);
    setSpent(null);
    setError(null);
    setPhase("idle");
    setPendingDeleteId(null);
  }

  async function poll(id: string) {
    const started = Date.now();
    while (Date.now() - started < 360_000) {
      const response = await fetch(`/api/ai-drawing/tasks/${id}`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!isRecord(body) || typeof body.status !== "string") {
        throw new Error("Unexpected task response");
      }
      if (body.status === "completed" && isRecord(body.result)) {
        const result = body.result as TaskResult;
        const conversationId = result.data?.conversationId;
        if (!conversationId) {
          throw new Error("Completed task has no conversation");
        }
        setSpent(result.data?.totalCreditsConsumed ?? null);
        setPhase("completed");
        setDraft(null);
        await refreshMe();
        await refreshList();
        await loadDetail(conversationId);
        return;
      }
      if (body.status === "failed") {
        const message = isRecord(body.result) && typeof body.result.error === "string" ? body.result.error : text.failed;
        throw new Error(message);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("Timed out");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSpent(null);
    if (mode !== "prompt") {
      if (!file) {
        setError(text.fileMissing);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError(text.fileLarge);
        return;
      }
    }
    const userText = mode === "prompt" ? prompt : note;
    setDraft(userText);
    setStageIndex(0);
    setPhase("pending");
    try {
      const payload: Record<string, unknown> = {
        templateId,
        styleId,
        aspectRatio: "4:3",
        resolution: "2K",
        batchCount,
        batchId: `optimistic-batch-${Date.now()}`,
        mode,
        textLanguage: locale === "zh" ? "zh" : "en",
      };
      if (selectedId) {
        payload.conversationId = selectedId;
      }
      if (mode === "prompt") {
        payload.prompt = prompt;
      } else {
        payload.supplementaryPrompt = note;
        payload.uploadedImageObjectKey = await uploadSource(file as File);
      }
      const response = await fetch("/api/ai-drawing/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (response.status === 401) {
        throw new Error(text.signIn);
      }
      if (!response.ok || !isRecord(body) || typeof body.id !== "string") {
        const message = isRecord(body) && typeof body.error === "string" ? body.error : "Request failed";
        throw new Error(message);
      }
      await poll(body.id);
    } catch (caught) {
      setPhase("failed");
      setDraft(null);
      setError(caught instanceof Error ? caught.message : text.failed);
    }
  }

  async function onConvert(imageUrl: string, kind: "svg-text" | "svg-full" | "pptx") {
    const key = `${imageUrl}:${kind}`;
    setConvertBusy(key);
    setError(null);
    try {
      const response = await fetch(kind === "pptx" ? "/api/convert-to-pptx" : "/api/convert-to-svg", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "pptx" ? { imageUrl } : { imageUrl, mode: kind === "svg-text" ? "text-only" : "full" }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body)) {
        const message = isRecord(body) && typeof body.error === "string" ? body.error : text.failed;
        throw new Error(message);
      }
      const url = kind === "pptx" ? body.pptxUrl : body.svgUrl;
      if (typeof url !== "string") {
        throw new Error(text.failed);
      }
      setDownloads((current) => ({ ...current, [key]: url }));
      await refreshMe();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : text.failed);
    } finally {
      setConvertBusy(null);
    }
  }

  async function removeConversation(id: string) {
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      return;
    }
    const outcome = await deleteConversationAction(id);
    if (!outcome.ok) {
      setError(outcome.error);
      setPendingDeleteId(null);
      return;
    }
    if (selectedId === id) {
      startNew();
    }
    setPendingDeleteId(null);
    await refreshList();
  }

  const shown: ThreadMessage[] =
    phase === "pending" && draft
      ? [...messages, { id: "optimistic", role: "user", content: draft, contentType: "text", metadata: null }]
      : messages;
  const unitCost = 5 * batchCount;

  return (
    <div className="grid items-start gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="space-y-3 border border-[var(--line)] bg-white/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm">{text.history}</h2>
          <button type="button" onClick={startNew} className="text-sm text-[var(--accent)]">
            {text.newFigure}
          </button>
        </div>
        {conversations.length === 0 ? <p className="text-sm text-[var(--muted)]">{text.emptyHistory}</p> : null}
        <ul className="space-y-2">
          {conversations.map((item) => (
            <li key={item.id} className={`border px-2 py-2 ${item.id === selectedId ? "border-[var(--accent)]" : "border-[var(--line)]"}`}>
              <button type="button" onClick={() => void loadDetail(item.id)} className="block w-full text-left">
                <span className="block truncate text-sm">{item.title}</span>
                <span className="text-xs text-[var(--muted)]">
                  {item.mode} · {item.messageCount}
                </span>
              </button>
              <button type="button" onClick={() => void removeConversation(item.id)} className="mt-1 text-xs text-[var(--danger)]">
                {pendingDeleteId === item.id ? text.confirmDelete : text.delete}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl">{text.title}</h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">{text.lead}</p>
          </div>
          <p className="text-sm">
            {text.credits}: {me ? me.creditsBalance : "—"}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          {(["prompt", "sketch", "replicate"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => chooseMode(item)}
              className={`border px-3 py-1 ${mode === item ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--line)] bg-white"}`}
            >
              {text.modes[item]}
            </button>
          ))}
        </div>
        <form onSubmit={onSubmit} className="space-y-4 border border-[var(--line)] bg-white/70 p-4">
          {mode === "prompt" ? (
            <label className="block space-y-1 text-sm">
              <span>{text.prompt}</span>
              <textarea
                required
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={text.placeholders.prompt}
                rows={5}
                className="w-full border border-[var(--line)] bg-white px-3 py-2"
              />
            </label>
          ) : (
            <>
              <label className="block space-y-1 text-sm">
                <span>{text.source}</span>
                <input
                  required
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="block w-full text-sm"
                />
                <span className="text-xs text-[var(--muted)]">{text.fileHint}</span>
              </label>
              <label className="block space-y-1 text-sm">
                <span>{text.note}</span>
                <textarea
                  required
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={text.placeholders[mode]}
                  rows={4}
                  className="w-full border border-[var(--line)] bg-white px-3 py-2"
                />
              </label>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span>{text.template}</span>
              <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} className="w-full border border-[var(--line)] bg-white px-2 py-2">
                {TEMPLATES.map((item) => (
                  <option key={item[0]} value={item[0]}>
                    {item[labelIndex]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span>{text.style}</span>
              <select value={styleId} onChange={(event) => setStyleId(event.target.value)} className="w-full border border-[var(--line)] bg-white px-2 py-2">
                {STYLES.map((item) => (
                  <option key={item[0]} value={item[0]}>
                    {item[labelIndex]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-[var(--muted)]">{text.resolution}</dt>
              <dd>2K</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">{text.count}</dt>
              <dd>
                <select
                  value={batchCount}
                  onChange={(event) => setBatchCount(event.target.value === "2" ? 2 : 1)}
                  className="border border-[var(--line)] bg-white px-2 py-1"
                  aria-label={text.count}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">{text.aspect}</dt>
              <dd>4:3</dd>
            </div>
          </dl>
          <p className="text-sm text-[var(--muted)]">
            {text.cost}: 5 × {batchCount} = {unitCost}
          </p>
          {me === undefined ? null : me ? (
            <button type="submit" disabled={phase === "pending"} className="bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-ink)] disabled:opacity-60">
              {phase === "pending" ? text.stages[stageIndex] : text.generate}
            </button>
          ) : (
            <Link href={signInHref} className="inline-block bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper)]">
              {text.signIn}
            </Link>
          )}
          {phase === "pending" && draft ? (
            <p className="text-sm text-[var(--muted)]">
              {text.pendingNote}: {draft}
            </p>
          ) : null}
          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        </form>
        {shown.length > 0 ? (
          <div className="space-y-4">
            {spent !== null ? (
              <p className="text-sm text-[var(--muted)]">
                {text.result} · {spent}
              </p>
            ) : null}
            {shown.map((item) => {
              const imageUrl = item.contentType === "image" ? imageUrlFromMetadata(item.metadata) : null;
              if (imageUrl) {
                return (
                  <figure key={item.id} className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl} alt={text.result} className="w-full border border-[var(--line)] bg-white" />
                    <figcaption className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-[var(--muted)]">{text.convert}</span>
                      {(
                        [
                          ["svg-text", text.svgText],
                          ["svg-full", text.svgFull],
                          ["pptx", text.pptx],
                        ] as const
                      ).map(([kind, label]) => {
                        const key = `${imageUrl}:${kind}`;
                        const href = downloads[key];
                        return href ? (
                          <a key={kind} href={`/api/download-image?url=${encodeURIComponent(href)}`} className="border border-[var(--line)] bg-white px-2 py-1">
                            {text.download} {label}
                          </a>
                        ) : (
                          <button
                            key={kind}
                            type="button"
                            disabled={convertBusy !== null}
                            onClick={() => void onConvert(imageUrl, kind)}
                            className="border border-[var(--line)] bg-white px-2 py-1 disabled:opacity-60"
                          >
                            {convertBusy === key ? "…" : label}
                          </button>
                        );
                      })}
                    </figcaption>
                  </figure>
                );
              }
              if (!item.content) {
                return null;
              }
              return (
                <p key={item.id} className="border border-[var(--line)] bg-white px-3 py-2 text-sm">
                  {item.content}
                </p>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}
