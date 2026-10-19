"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Locale = "en" | "zh";

type MeResponse = {
  user: { id: string; email: string; name: string; creditsBalance: number } | null;
};

type TaskResult = {
  success?: boolean;
  error?: string;
  data?: {
    totalCreditsConsumed?: number;
    results?: Array<{ imageUrl: string; creditsConsumed: number }>;
  };
};

const copy = {
  en: {
    title: "Prompt figure",
    lead: "Write what the figure should show. Resolution stays at 2K and the batch size stays at 1.",
    prompt: "Prompt",
    resolution: "Resolution",
    count: "Count",
    aspect: "Aspect",
    generate: "Generate",
    signIn: "Sign in to generate",
    credits: "Credits",
    waiting: "Drawing is still running",
    failed: "Drawing failed",
    result: "Result",
    placeholder: "A labeled cross-section of a leaf, with the vein system called out",
  },
  zh: {
    title: "提示词绘图",
    lead: "写下图里需要出现的内容。分辨率固定为 2K，张数固定为 1。",
    prompt: "提示词",
    resolution: "分辨率",
    count: "张数",
    aspect: "比例",
    generate: "生成",
    signIn: "登录后生成",
    credits: "积分",
    waiting: "正在绘制",
    failed: "绘制失败",
    result: "结果",
    placeholder: "叶片横切面，标出叶脉",
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function AiDrawingStudio({ locale }: { locale: Locale }) {
  const text = copy[locale];
  const signInHref = `/sign-in?next=${encodeURIComponent(locale === "zh" ? "/zh/ai-drawing" : "/ai-drawing")}`;
  const [prompt, setPrompt] = useState("");
  const [me, setMe] = useState<MeResponse["user"] | undefined>(undefined);
  const [phase, setPhase] = useState<"idle" | "pending" | "completed" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [spent, setSpent] = useState<number | null>(null);

  async function refreshMe() {
    const response = await fetch("/api/me", { cache: "no-store" });
    const body = (await response.json()) as MeResponse;
    setMe(body.user);
  }

  useEffect(() => {
    void refreshMe();
  }, []);

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
        const url = result.data?.results?.[0]?.imageUrl;
        if (!url) {
          throw new Error("Completed task has no image");
        }
        setImageUrl(url);
        setSpent(result.data?.totalCreditsConsumed ?? null);
        setPhase("completed");
        await refreshMe();
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
    setImageUrl(null);
    setSpent(null);
    setPhase("pending");
    try {
      const response = await fetch("/api/ai-drawing/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          templateId: "none",
          styleId: "none",
          aspectRatio: "4:3",
          resolution: "2K",
          batchCount: 1,
          batchId: `optimistic-batch-${Date.now()}`,
          mode: "prompt",
          textLanguage: locale,
        }),
      });
      const body: unknown = await response.json();
      if (response.status === 401) {
        throw new Error(text.signIn);
      }
      if (!response.ok || !isRecord(body) || typeof body.id !== "string") {
        const message = isRecord(body) && typeof body.error === "string" ? body.error : "Request failed";
        throw new Error(message);
      }
      if (body.status === "completed" || body.status === "failed" || body.status === "pending" || body.status === "running") {
        await poll(body.id);
      }
    } catch (caught) {
      setPhase("failed");
      setError(caught instanceof Error ? caught.message : text.failed);
    }
  }

  return (
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
      <form onSubmit={onSubmit} className="space-y-4 border border-[var(--line)] bg-white/70 p-4">
        <label className="block space-y-1 text-sm">
          <span>{text.prompt}</span>
          <textarea
            required
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={text.placeholder}
            rows={5}
            className="w-full border border-[var(--line)] bg-white px-3 py-2"
          />
        </label>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-[var(--muted)]">{text.resolution}</dt>
            <dd>2K</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">{text.count}</dt>
            <dd>1</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">{text.aspect}</dt>
            <dd>4:3</dd>
          </div>
        </dl>
        {me === undefined ? null : me ? (
          <button type="submit" disabled={phase === "pending"} className="bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-ink)] disabled:opacity-60">
            {phase === "pending" ? text.waiting : text.generate}
          </button>
        ) : (
          <Link href={signInHref} className="inline-block bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper)]">
            {text.signIn}
          </Link>
        )}
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </form>
      {imageUrl ? (
        <figure className="space-y-2">
          <figcaption className="text-sm text-[var(--muted)]">
            {text.result}
            {spent !== null ? ` · ${spent}` : ""}
          </figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={text.result} className="w-full border border-[var(--line)] bg-white" />
        </figure>
      ) : null}
    </section>
  );
}
