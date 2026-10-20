import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-[var(--line)]">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <Link href="/" className="text-sm font-semibold tracking-wide">
          sci-draw
        </Link>
        <nav className="flex items-center gap-4 text-sm text-[var(--muted)]">
          <Link href="/ai-drawing">Drawing</Link>
          <Link href="/convert">Convert</Link>
          <Link href="/sci-vis">SciVis</Link>
          <Link href="/settings/api-keys">API</Link>
          <Link href="/billing">Credits</Link>
          <Link href="/zh/ai-drawing">中文</Link>
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </div>
    </header>
  );
}
