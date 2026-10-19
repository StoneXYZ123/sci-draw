import Link from "next/link";

export default function HomePage() {
  return (
    <section className="space-y-6">
      <p className="text-sm uppercase tracking-[0.18em] text-[var(--muted)]">Prompt figures</p>
      <h1 className="max-w-xl text-4xl leading-tight">Describe a figure. Spend a few credits. Keep the image.</h1>
      <p className="max-w-xl text-[var(--muted)]">
        This workspace covers account sign-in and a single prompt-to-image pass. Sketch upload, file conversion, and chart code come later.
      </p>
      <div className="flex gap-3">
        <Link href="/ai-drawing" className="bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-ink)]">
          Open the studio
        </Link>
        <Link href="/sign-up" className="border border-[var(--line)] px-4 py-2 text-sm">
          Create an account
        </Link>
      </div>
    </section>
  );
}
