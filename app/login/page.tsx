"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectTo = useMemo(() => {
    const r = searchParams.get("redirect");
    return r && r.startsWith("/") ? r : "/ai-demo";
  }, [searchParams]);

  const [mode, setMode] = useState<"login" | "signup" | "magic" | "forgot">(
    "login"
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ✅ hydration-safe origin (only after mount)
  const [mounted, setMounted] = useState(false);
  const [origin, setOrigin] = useState<string>("");

  useEffect(() => {
    setMounted(true);
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    // If already logged in, go straight in.
    supabaseClient.auth.getSession().then(({ data }) => {
      if (data.session) router.replace(redirectTo);
    });
  }, [router, redirectTo]);

  const onEmailPassword = async () => {
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      if (!email.trim()) throw new Error("Email is required.");
      if (!password.trim()) throw new Error("Password is required.");

      if (mode === "signup") {
        const { error } = await supabaseClient.auth.signUp({
          email: email.trim(),
          password,
          options: {
            // keeps sign-up confirmation redirects sane
            emailRedirectTo: origin ? `${origin}${redirectTo}` : undefined,
          },
        });
        if (error) throw error;

        setMsg(
          "Signup successful. If email confirmation is enabled, check your inbox."
        );

        // If confirmation is OFF, user might already be logged in:
        const { data } = await supabaseClient.auth.getSession();
        if (data.session) router.replace(redirectTo);
        return;
      }

      const { error } = await supabaseClient.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;

      router.replace(redirectTo);
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const onMagicLink = async () => {
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      if (!email.trim()) throw new Error("Email is required.");

      const emailRedirectTo = origin ? `${origin}${redirectTo}` : undefined;

      const { error } = await supabaseClient.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo,
        },
      });
      if (error) throw error;

      setMsg("Magic link sent. Open your inbox and click the link to login.");
    } catch (e: any) {
      setErr(e?.message ?? "Could not send magic link.");
    } finally {
      setLoading(false);
    }
  };

  const onForgotPassword = async () => {
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      if (!email.trim()) throw new Error("Email is required.");

      // You can later create /update-password page; for MVP we’ll still send reset.
      const redirectUrl = origin ? `${origin}/update-password` : undefined;

      const { error } = await supabaseClient.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: redirectUrl }
      );
      if (error) throw error;

      setMsg("Password reset email sent. Check your inbox.");
    } catch (e: any) {
      setErr(e?.message ?? "Could not send reset email.");
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === "signup"
      ? "Sign up"
      : mode === "magic"
      ? "Magic link"
      : mode === "forgot"
      ? "Reset your password"
      : "Login";

  const subtitle =
    mode === "signup"
      ? "Create your account."
      : mode === "magic"
      ? "We’ll email you a one-click login link."
      : mode === "forgot"
      ? "We’ll send you a password reset email."
      : "Sign in to continue.";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-md mx-auto space-y-6">
        <header className="text-center space-y-2">
          <div className="text-xs tracking-[0.35em] text-slate-400 uppercase">
            UPSC PYQ Intelligence Engine
          </div>
          <h1 className="text-3xl font-semibold">{title}</h1>
          <p className="text-sm text-slate-400">{subtitle}</p>
        </header>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["login", "signup", "magic", "forgot"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setErr(null);
                  setMsg(null);
                }}
                className={`px-3 py-2 text-sm rounded-md border ${
                  mode === m
                    ? "bg-emerald-500 text-slate-950 border-emerald-500"
                    : "bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800"
                }`}
              >
                {m === "login"
                  ? "Login"
                  : m === "signup"
                  ? "Sign up"
                  : m === "magic"
                  ? "Magic link"
                  : "Forgot password"}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Email
              </span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>

            {mode !== "magic" && mode !== "forgot" && (
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

            {err && (
              <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {err}
              </div>
            )}
            {msg && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                {msg}
              </div>
            )}

            <button
              type="button"
              disabled={loading}
              onClick={
                mode === "magic"
                  ? onMagicLink
                  : mode === "forgot"
                  ? onForgotPassword
                  : onEmailPassword
              }
              className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {loading
                ? "Please wait…"
                : mode === "magic"
                ? "Send magic link"
                : mode === "forgot"
                ? "Send reset email"
                : mode === "signup"
                ? "Create account"
                : "Login"}
            </button>

            <div className="flex items-center justify-between text-xs text-slate-500">
              <button
                type="button"
                className="hover:text-slate-300"
                onClick={() => {
                  setMode("login");
                  setErr(null);
                  setMsg(null);
                }}
              >
                Back to login
              </button>
              <div>
                Redirects to{" "}
                <span className="text-slate-300">{redirectTo}</span>
              </div>
            </div>

            {/* ✅ Hydration-safe: render origin only after mounted */}
            <p className="text-[11px] text-slate-600 mt-2">
              Tip: If the email link opens an error page, ensure your Supabase
              Auth “Site URL” and “Redirect URLs” include{" "}
              <span className="text-slate-300">
                {mounted ? origin : ""}
              </span>
              {mounted ? "" : ""}
              .
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
