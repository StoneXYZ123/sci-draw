"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Pack = { id: string; credits: number; available: boolean };
type MeResponse = {
  user: { id: string; email: string; name: string; creditsBalance: number } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function BillingPanel({ checkout }: { checkout?: string }) {
  const [me, setMe] = useState<MeResponse["user"] | undefined>(undefined);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [meResponse, packResponse] = await Promise.all([fetch("/api/me", { cache: "no-store" }), fetch("/api/billing/packs", { cache: "no-store" })]);
      const meBody = (await meResponse.json()) as MeResponse;
      setMe(meBody.user);
      const packBody: unknown = await packResponse.json();
      if (isRecord(packBody) && Array.isArray(packBody.packs)) {
        setPacks(packBody.packs as Pack[]);
        setConfigured(packBody.configured === true);
      }
    })();
  }, []);

  async function buy(pack: string) {
    setBusy(pack);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || typeof body.url !== "string") {
        const message = isRecord(body) && typeof body.error === "string" ? body.error : "Could not start checkout";
        throw new Error(message);
      }
      window.location.assign(body.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start checkout");
      setBusy(null);
    }
  }

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">Buy credits</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Checkout is handled by Stripe in test or live mode. Credits are added only after the signed webhook records the payment.</p>
        </div>
        <p className="text-sm">Credits: {me ? me.creditsBalance : "—"}</p>
      </div>
      {checkout === "success" ? <p className="text-sm">Payment submitted. The balance updates when the webhook arrives.</p> : null}
      {checkout === "cancel" ? <p className="text-sm">Checkout was canceled. No credits were added.</p> : null}
      {!configured ? <p className="text-sm text-[var(--muted)]">Payments are not configured on this server.</p> : null}
      {me === undefined ? null : me ? (
        <ul className="space-y-2">
          {packs.map((pack) => (
            <li key={pack.id} className="flex items-center justify-between border border-[var(--line)] bg-white px-3 py-3 text-sm">
              <span>{pack.credits} credits</span>
              <button type="button" disabled={!pack.available || busy === pack.id} onClick={() => void buy(pack.id)} className="bg-[var(--accent)] px-3 py-2 text-[var(--accent-ink)] disabled:opacity-60">
                {busy === pack.id ? "Redirecting" : "Buy"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Link href="/sign-in?next=%2Fbilling" className="inline-block bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper)]">
          Sign in to buy credits
        </Link>
      )}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
    </section>
  );
}
