// app/login/page.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

export default function LoginPage() {
  return (
    <Suspense fallback={<Shell loading />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectTo = searchParams.get("redirect") || "/practice";

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
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

  const onLogin = async () => {
    setMsg(null);
    setLoading(true);
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password: pw,
      });

      if (error || !data.session) {
        setMsg(error?.message || "Login failed.");
        return;
      }

      router.replace(redirectTo);
    } catch (e) {
      setMsg("Unexpected error during login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell loading={false}>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Login</h1>
          <p className="text-sm text-slate-400 mt-1">
            Sign in to continue.
          </p>
        </div>

        <div className="space-y-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-md bg-slate-950/60 border border-slate-700 px-3 py-2 text-sm text-slate-100"
          />
          <input
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Password"
            type="password"
            className="w-full rounded-md bg-slate-950/60 border border-slate-700 px-3 py-2 text-sm text-slate-100"
          />

          <button
            onClick={onLogin}
            disabled={loading || !email || !pw}
            className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>

          {msg && <p className="text-sm text-rose-300">{msg}</p>}
        </div>

        <p className="text-xs text-slate-500">
          After login you’ll be redirected to:{" "}
          <span className="text-slate-300">{redirectTo}</span>
        </p>
      </div>
    </Shell>
  );
}

function Shell({ loading, children }: { loading: boolean; children?: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-lg mx-auto">
        {loading ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : (
          children
        )}
      </div>
    </main>
  );
}
