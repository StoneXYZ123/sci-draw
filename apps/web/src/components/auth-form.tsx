"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type AuthMode = "sign-in" | "sign-up";

export function AuthForm({ mode, nextPath }: { mode: AuthMode; nextPath: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not continue");
      return;
    }
    router.push(nextPath);
    router.refresh();
  }

  const title = mode === "sign-up" ? "Create an account" : "Sign in";

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <h1 className="text-3xl">{title}</h1>
      {mode === "sign-up" ? (
        <label className="block space-y-1 text-sm">
          <span>Name</span>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full border border-[var(--line)] bg-white px-3 py-2"
            autoComplete="name"
          />
        </label>
      ) : null}
      <label className="block space-y-1 text-sm">
        <span>Email</span>
        <input
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full border border-[var(--line)] bg-white px-3 py-2"
          autoComplete="email"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Password</span>
        <input
          required
          type="password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full border border-[var(--line)] bg-white px-3 py-2"
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
        />
      </label>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <button type="submit" disabled={pending} className="bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper)] disabled:opacity-60">
        {pending ? "Working…" : title}
      </button>
      <p className="text-sm text-[var(--muted)]">
        {mode === "sign-up" ? (
          <Link href={`/sign-in?next=${encodeURIComponent(nextPath)}`}>Already have an account</Link>
        ) : (
          <Link href={`/sign-up?next=${encodeURIComponent(nextPath)}`}>Need an account</Link>
        )}
      </p>
    </form>
  );
}
