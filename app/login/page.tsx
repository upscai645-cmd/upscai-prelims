"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

function LoadingCard({ text }: { text: string }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-xl mx-auto">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          {text}
        </div>
      </div>
    </main>
  );
}

function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectTo = useMemo(() => {
    const r = searchParams.get("redirect");
    return r && r.startsWith("/") ? r : "/practice";
  }, [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // If already logged in, go straight to redirect
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setLoading(true);
      const { data } = await supabaseClient.auth.getUser();
      if (!cancelled && data.user) {
        router.replace(redirectTo);
        return;
      }
      if (!cancelled) setLoading(false);
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, [router, redirectTo]);

  const onLogin = async () => {
    setErr(null);

    const e = email.trim();
    if (!e) return setErr("Enter your email.");
    if (!password) return setErr("Enter your password.");

    setSubmitting(true);
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: e,
        password,
      });

      if (error) throw error;

      // After login: if onboarding is incomplete, your middleware should reroute.
      router.replace(redirectTo);
    } catch (e: any) {
      setErr(e?.message ?? "Login failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingCard text="Checking session…" />;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-xl mx-auto space-y-6">
        <header className="space-y-2">
          <div className="text-xs tracking-widest text-slate-400">UPSC AI</div>
          <h1 className="text-3xl font-semibold">Login</h1>
          <p className="text-sm text-slate-400">
            After login you’ll continue to{" "}
            <span className="text-slate-200">{redirectTo}</span>
          </p>
        </header>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Email
            </span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm"
              placeholder="you@email.com"
              autoComplete="email"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Password
            </span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>

          {err && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {err}
            </div>
          )}

          <button
            type="button"
            disabled={submitting}
            onClick={onLogin}
            className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  // ✅ Fix for Vercel build: wrap anything using useSearchParams() in Suspense
  return (
    <Suspense fallback={<LoadingCard text="Loading login…" />}>
      <LoginClient />
    </Suspense>
  );
}
