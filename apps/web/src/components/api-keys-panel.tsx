"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type MeResponse = {
  user: { id: string; email: string; name: string; creditsBalance: number } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function ApiKeysPanel() {
  const [me, setMe] = useState<MeResponse["user"] | undefined>(undefined);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [name, setName] = useState("default");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const response = await fetch("/api/api-keys", { cache: "no-store" });
    if (response.status === 401) {
      setKeys([]);
      return;
    }
    const body: unknown = await response.json();
    if (isRecord(body) && Array.isArray(body.keys)) {
      setKeys(body.keys as KeyRow[]);
    }
  }

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      const body = (await response.json()) as MeResponse;
      setMe(body.user);
      if (body.user) {
        await reload();
      }
    })();
  }, []);

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || typeof body.secret !== "string") {
        const message = isRecord(body) && typeof body.error === "string" ? body.error : "Could not create a key";
        throw new Error(message);
      }
      setSecret(body.secret);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create a key");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    const response = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Could not revoke the key");
      return;
    }
    await reload();
  }

  if (me === undefined) {
    return <p className="text-sm text-[var(--muted)]">Loading</p>;
  }
  if (!me) {
    return (
      <p className="text-sm">
        <Link href="/sign-in?next=%2Fsettings%2Fapi-keys" className="underline">
          Sign in
        </Link>{" "}
        to create an API key.
      </p>
    );
  }

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-3xl">API keys</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Keys start with <code>sd_</code> and authorize <code>/api/v1</code>. The secret is shown once. Send it as <code>Authorization: Bearer</code>.
        </p>
      </div>
      <form onSubmit={(event) => void createKey(event)} className="flex gap-2">
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} className="flex-1 border border-[var(--line)] bg-white px-3 py-2 text-sm" aria-label="Key name" />
        <button type="submit" disabled={busy} className="bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-ink)] disabled:opacity-60">
          Create
        </button>
      </form>
      {secret ? (
        <p className="border border-[var(--line)] bg-white p-3 text-sm">
          Copy this secret now. It is not stored in a recoverable form.
          <code className="mt-2 block break-all">{secret}</code>
        </p>
      ) : null}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <ul className="space-y-2 text-sm">
        {keys.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 border border-[var(--line)] bg-white px-3 py-2">
            <span>
              {item.name} · {item.prefix}…{item.revokedAt ? " · revoked" : ""}
            </span>
            {item.revokedAt ? null : (
              <button type="button" onClick={() => void revoke(item.id)} className="text-sm underline">
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
