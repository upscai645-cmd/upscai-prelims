// app/login/page.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
          <div className="max-w-md mx-auto text-sm text-slate-400">
            Loading login…
          </div>
        </main>
      }
    >
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectTo = searchParams.get("redirect") || "/practice";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // If already logged in, go straight to redirect target
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabaseClient.auth.getSession();
      if (!alive) return;
      if (data.session) router.replace(redirectTo);
    })();
    return () => {
      alive = false;
    };
  }, [router, redirectTo]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const { error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMsg(error.message);
        return;
      }

      router.replace(redirectTo);
    } catch {
      setMsg("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-md mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Login</h1>
          <p className="text-sm text-slate-400 mt-1">
            You’ll be redirected to:{" "}
            <span className="text-slate-200 font-medium">{redirectTo}</span>
          </p>
        </header>

        <form
          onSubmit={handleLogin}
          className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4"
        >
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wide text-slate-400">
              Email
            </label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              className="w-full rounded-md bg-slate-950/60 border border-slate-700 px-3 py-2 text-sm"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wide text-slate-400">
              Password
            </label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              className="w-full rounded-md bg-slate-950/60 border border-slate-700 px-3 py-2 text-sm"
              placeholder="••••••••"
            />
          </div>

          {msg && <div className="text-sm text-rose-400">{msg}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {loading ? "Logging in…" : "Login"}
          </button>
        </form>
      </div>
    </main>
  );
}
