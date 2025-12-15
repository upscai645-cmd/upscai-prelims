"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  state_of_preparation: string | null;
  upsc_attempts: number | null;
};

function isProfileComplete(p?: ProfileRow | null) {
  if (!p) return false;
  const nameOk = (p.full_name ?? "").trim().length >= 2;
  const phoneOk = (p.phone ?? "").trim().length >= 8; // lenient
  const stateOk = (p.state_of_preparation ?? "").trim().length >= 2;
  const attemptsOk = typeof p.upsc_attempts === "number" && p.upsc_attempts >= 0;
  return nameOk && phoneOk && stateOk && attemptsOk;
}

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectTo = useMemo(() => {
    const r = searchParams.get("redirect");
    return r && r.startsWith("/") ? r : "/practice";
  }, [searchParams]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [statePrep, setStatePrep] = useState("");
  const [attempts, setAttempts] = useState<string>("");

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setLoading(true);
      setErr(null);
      setMsg(null);

      // 1) Must be logged in
      const { data: userData, error: userErr } = await supabaseClient.auth.getUser();
      const user = userData.user;

      if (!user || userErr) {
        router.replace(`/login?redirect=/onboarding`);
        return;
      }

      if (cancelled) return;

      setUserId(user.id);
      setEmail(user.email ?? "");

      // 2) Fetch existing profile (if any)
      const { data: profile, error: profErr } = await supabaseClient
        .from("profiles")
        .select("id, email, full_name, phone, state_of_preparation, upsc_attempts")
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (profErr) {
        setErr(profErr.message);
        setLoading(false);
        return;
      }

      // 3) If already complete → go straight to practice
      if (isProfileComplete(profile as ProfileRow | null)) {
        router.replace(redirectTo);
        return;
      }

      // 4) Prefill form from existing profile
      if (profile) {
        setFullName((profile.full_name ?? "").toString());
        setPhone((profile.phone ?? "").toString());
        setStatePrep((profile.state_of_preparation ?? "").toString());
        setAttempts(
          profile.upsc_attempts === null || profile.upsc_attempts === undefined
            ? ""
            : String(profile.upsc_attempts)
        );
      }

      setLoading(false);
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, [router, redirectTo]);

  const onSave = async () => {
    setErr(null);
    setMsg(null);

    if (!userId) {
      setErr("Not logged in.");
      return;
    }

    const n = fullName.trim();
    const p = phone.trim();
    const s = statePrep.trim();

    if (n.length < 2) return setErr("Please enter your full name.");
    if (p.length < 8) return setErr("Please enter a valid phone number.");
    if (s.length < 2) return setErr("Please enter your state of preparation.");

    const aNum = attempts.trim() === "" ? NaN : Number(attempts);
    if (!Number.isFinite(aNum) || aNum < 0 || aNum > 20) {
      return setErr("Please enter a valid number of UPSC attempts (0–20).");
    }

    setSaving(true);
    try {
      const payload: ProfileRow = {
        id: userId,
        email: email || null,
        full_name: n,
        phone: p,
        state_of_preparation: s,
        upsc_attempts: aNum,
      };

      const { error } = await supabaseClient.from("profiles").upsert(payload, {
        onConflict: "id",
      });

      if (error) throw error;

      setMsg("Profile saved. Redirecting…");
      router.replace(redirectTo);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
        <div className="max-w-xl mx-auto">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            Loading onboarding…
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-xl mx-auto space-y-6">
        <header className="space-y-2">
          <div className="text-xs tracking-widest text-slate-400">
            UPSC PYQ INTELLIGENCE ENGINE
          </div>
          <h1 className="text-3xl font-semibold">Candidate onboarding</h1>
          <p className="text-sm text-slate-400">
            Fill these once. We’ll use it later for analytics + personalization.
          </p>
        </header>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <div className="grid gap-4">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Email (from login)
              </span>
              <input
                value={email}
                disabled
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm opacity-80"
              />
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Full name
              </span>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm"
                placeholder="Your name"
              />
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Phone
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm"
                placeholder="10-digit mobile number"
                inputMode="tel"
              />
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                State of preparation
              </span>
              <input
                value={statePrep}
                onChange={(e) => setStatePrep(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm"
                placeholder="e.g., Delhi / Karnataka / Remote"
              />
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                UPSC attempts so far
              </span>
              <input
                value={attempts}
                onChange={(e) => setAttempts(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm"
                placeholder="0"
                inputMode="numeric"
              />
            </label>
          </div>

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

          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onSave}
              className="flex-1 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save & continue"}
            </button>

            <button
              type="button"
              onClick={() => router.replace(redirectTo)}
              className="rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Skip for now
            </button>
          </div>

          <p className="text-xs text-slate-500">
            After save: <span className="text-slate-300">{redirectTo}</span>
          </p>
        </div>
      </div>
    </main>
  );
}
