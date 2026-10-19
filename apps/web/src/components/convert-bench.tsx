"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type MeResponse = {
  user: { id: string; email: string; name: string; creditsBalance: number } | null;
};

type Format = "svg" | "pptx" | "png" | "pdf" | "tiff";
type SvgMode = "text-only" | "full";
type Dpi = 300 | 600 | 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function price(format: Format, mode: SvgMode, dpi: Dpi): number {
  switch (format) {
    case "svg":
      return mode === "text-only" ? 10 : 15;
    case "pptx":
      return 10;
    case "png":
    case "pdf":
    case "tiff":
      switch (dpi) {
        case 300:
          return 5;
        case 600:
          return 10;
        case 1000:
          return 15;
        default: {
          const neverDpi: never = dpi;
          return neverDpi;
        }
      }
    default: {
      const neverFormat: never = format;
      return neverFormat;
    }
  }
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

async function uploadConvertSource(file: File): Promise<string> {
  const contentType = contentTypeFor(file);
  const presignResponse = await fetch("/api/storage/direct-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "presign",
      purpose: "convert-source",
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
  const completeResponse = await fetch("/api/storage/direct-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "complete", purpose: "convert-source", objectKey: presign.objectKey }),
  });
  const completed: unknown = await completeResponse.json();
  if (!completeResponse.ok) {
    const message = isRecord(completed) && typeof completed.error === "string" ? completed.error : "Upload failed";
    throw new Error(message);
  }
  return presign.objectKey;
}

export function ConvertBench() {
  const [me, setMe] = useState<MeResponse["user"] | undefined>(undefined);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<Format>("svg");
  const [mode, setMode] = useState<SvgMode>("full");
  const [dpi, setDpi] = useState<Dpi>(300);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [spent, setSpent] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      const body = (await response.json()) as MeResponse;
      setMe(body.user);
    })();
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDownloadUrl(null);
    setSpent(null);
    if (!file) {
      setError("Choose an image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be 5 MB or smaller");
      return;
    }
    setBusy(true);
    try {
      const objectKey = await uploadConvertSource(file);
      const response = await fetch("/api/convert-format", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objectKey,
          filename: file.name,
          format,
          mode: format === "svg" ? mode : undefined,
          dpi: format === "png" || format === "pdf" || format === "tiff" ? dpi : undefined,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || typeof body.downloadUrl !== "string") {
        const message = isRecord(body) && typeof body.error === "string" ? body.error : "Convert failed";
        throw new Error(message);
      }
      setDownloadUrl(body.downloadUrl);
      setSpent(typeof body.creditsConsumed === "number" ? body.creditsConsumed : price(format, mode, dpi));
      const meResponse = await fetch("/api/me", { cache: "no-store" });
      const meBody = (await meResponse.json()) as MeResponse;
      setMe(meBody.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Convert failed");
    } finally {
      setBusy(false);
    }
  }

  const cost = price(format, mode, dpi);

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">Convert a figure</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Upload a PNG, JPEG, or WebP. SVG and PPTX come back in the same request. VSDX is not available in this release.</p>
        </div>
        <p className="text-sm">Credits: {me ? me.creditsBalance : "—"}</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4 border border-[var(--line)] bg-white/70 p-4">
        <label className="block space-y-1 text-sm">
          <span>Image</span>
          <input required type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="block w-full text-sm" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Format</span>
          <select value={format} onChange={(event) => setFormat(event.target.value as Format)} className="w-full border border-[var(--line)] bg-white px-2 py-2">
            <option value="svg">SVG</option>
            <option value="pptx">PPTX</option>
            <option value="png">PNG</option>
            <option value="pdf">PDF</option>
            <option value="tiff">TIFF</option>
          </select>
        </label>
        {format === "svg" ? (
          <label className="block space-y-1 text-sm">
            <span>SVG mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value === "text-only" ? "text-only" : "full")} className="w-full border border-[var(--line)] bg-white px-2 py-2">
              <option value="full">Paths</option>
              <option value="text-only">Text layer</option>
            </select>
          </label>
        ) : null}
        {format === "png" || format === "pdf" || format === "tiff" ? (
          <label className="block space-y-1 text-sm">
            <span>DPI</span>
            <select value={dpi} onChange={(event) => setDpi(Number(event.target.value) as Dpi)} className="w-full border border-[var(--line)] bg-white px-2 py-2">
              <option value={300}>300</option>
              <option value={600}>600</option>
              <option value={1000}>1000</option>
            </select>
          </label>
        ) : null}
        <p className="text-sm text-[var(--muted)]">Cost: {cost}</p>
        {me === undefined ? null : me ? (
          <button type="submit" disabled={busy} className="bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-ink)] disabled:opacity-60">
            {busy ? "Converting" : "Convert"}
          </button>
        ) : (
          <Link href="/sign-in?next=%2Fconvert" className="inline-block bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper)]">
            Sign in to convert
          </Link>
        )}
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </form>
      {downloadUrl ? (
        <p className="text-sm">
          <a href={`/api/download-image?url=${encodeURIComponent(downloadUrl)}`} className="border border-[var(--line)] bg-white px-3 py-2">
            Download{spent !== null ? ` · ${spent}` : ""}
          </a>
        </p>
      ) : null}
    </section>
  );
}
