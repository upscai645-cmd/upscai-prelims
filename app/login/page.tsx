"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

/* ----------------------------------------------------- */
/* UI Helpers */
/* ----------------------------------------------------- */

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

type Mode = "login" | "signup" | "reset";

/* ----------------------------------------------------- */
/* Client */
/* ----------------------------------------------------- */

function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectTo = useMemo(() => {
    const r = searchParams.get("redirect");
    return r && r.startsWith("/") ? r : "/practice";
  }, [searchParams]);

  const [mode, setMode] = useState<Mode>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* --------------------------------------------------- */
  /* Boot: redirect if already logged in */
  /* --------------------------------------------------- */
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

  /* --------------------------------------------------- */
  /* Actions */
  /* --------------------------------------------------- */

  async function onLogin() {
    setError(null);
    setMessage(null);

    if (!email.trim()) return setError("Enter your email.");
    if (!password) return setError("Enter your password.");

    setSubmitting(true);
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;
      router.replace(redirectTo);
    } catch (e: any) {
      setError(e?.message ?? "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSignup() {
    setError(null);
    setMessage(null);

    if (!email.trim()) return setError("Enter your email.");
    if (!password || password.length < 6)
      return setError("Password must be at least 6 characters.");

    setSubmitting(true);
    try {
      const { error } = await supabaseClient.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${location.origin}/login`,
        },
      });

      if (error) throw error;

      setMessage(
        "Account created. Please check your email to verify your account before logging in."
      );
      setMode("login");
      setPassword("");
    } catch (e: any) {
      setError(e?.message ?? "Signup failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onResetPassword() {
    setError(null);
    setMessage(null);

    if (!email.trim()) return setError("Enter your email.");

    setSubmitting(true);
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${location.origin}/login`,
        }
      );

      if (error) throw error;

      setMessage("Password reset email sent. Check your inbox.");
      setMode("login");
    } catch (e: any) {
      setError(e?.message ?? "Failed to send reset email.");
    } finally {
      setSubmitting(false);
    }
  }

  /* --------------------------------------------------- */

  if (loading) return <LoadingCard text="Checking session…" />;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-xl mx-auto space-y-6">
        <header className="space-y-2">
          <div className="text-xs tracking-widest text-slate-400">UPSC AI</div>
          <h1 className="text-3xl font-semibold">
            {mode === "login" && "Login"}
            {mode === "signup" && "Create Account"}
            {mode === "reset" && "Reset Password"}
          </h1>
          <p className="text-sm text-slate-400">
            After authentication you’ll continue to{" "}
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

          {mode !== "reset" && (
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
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
              />
            </label>
          )}

          {error && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          )}

          {message && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {message}
            </div>
          )}

          {mode === "login" && (
            <button
              disabled={submitting}
              onClick={onLogin}
              className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          )}

          {mode === "signup" && (
            <button
              disabled={submitting}
              onClick={onSignup}
              className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitting ? "Creating account…" : "Create account"}
            </button>
          )}

          {mode === "reset" && (
            <button
              disabled={submitting}
              onClick={onResetPassword}
              className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitting ? "Sending email…" : "Send reset email"}
            </button>
          )}

          <div className="flex justify-between text-sm text-slate-400 pt-2">
            {mode !== "login" && (
              <button
                className="hover:text-slate-200"
                onClick={() => setMode("login")}
              >
                Back to login
              </button>
            )}

            {mode === "login" && (
              <>
                <button
                  className="hover:text-slate-200"
                  onClick={() => setMode("signup")}
                >
                  Create account
                </button>
                <button
                  className="hover:text-slate-200"
                  onClick={() => setMode("reset")}
                >
                  Forgot password?
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

/* ----------------------------------------------------- */
/* Page */
/* ----------------------------------------------------- */

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingCard text="Loading login…" />}>
      <LoginClient />
    </Suspense>
  );
}
