// app/onboarding/OnboardingClient.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

type Props = {
  redirectTo: string;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  state_of_preparation: string | null;
  upsc_attempts: number | null;
};

export default function OnboardingClient({ redirectTo }: Props) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [email, setEmail] = useState<string>("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [stateOfPrep, setStateOfPrep] = useState("");
  const [attempts, setAttempts] = useState<string>("0");

  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Load session + existing profile
  useEffect(() => {
    let alive = true;

    const run = async () => {
      setErr(null);
      setMsg(null);
      setLoading(true);

      try {
        const { data } = await supabaseClient.auth.getSession();
        const session = data.session;

        if (!session) {
          router.replace(`/login?redirect=/onboarding`);
          return;
        }

        const userId = session.user.id;
        const userEmail = session.user.email ?? "";
        if (alive) setEmail(userEmail);

        const { data: profile, error } = await supabaseClient
          .from("profiles")
          .select("id, email, full_name, phone, state_of_preparation, upsc_attempts")
          .eq("id", userId)
          .maybeSingle();

        if (error) throw error;

        // If profile exists and seems complete, send user onwards
        if (profile) {
          const p = profile as ProfileRow;

          const complete =
            !!(p.full_name && p.full_name.trim()) &&
            !!(p.phone && p.phone.trim()) &&
            !!(p.state_of_preparation && p.state_of_preparation.trim()) &&
            typeof p.upsc_attempts === "number";

          if (complete) {
            router.replace(redirectTo);
            return;
          }

          // Pre-fill whatever exists
          if (alive) {
            setFullName(p.full_name ?? "");
            setPhone(p.phone ?? "");
            setStateOfPrep(p.state_of_preparation ?? "");
            setAttempts(
              typeof p.upsc_attempts === "number" ? String(p.upsc_attempts) : "0"
            );
          }
        }
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load onboarding.");
      } finally {
        if (alive) setLoading(false);
      }
    };

    run();

    return () => {
      alive = false;
    };
  }, [router, redirectTo]);

  const onSave = async () => {
    setErr(null);
    setMsg(null);

    if (!fullName.trim()) return setErr("Full name is required.");
    if (!phone.trim()) return setErr("Phone is required.");
    if (!stateOfPrep.trim()) return setErr("State of preparation is required.");

    const attemptsNum = Number(attempts);
    if (!Number.isFinite(attemptsNum) || attemptsNum < 0 || attemptsNum > 20) {
      return setErr("UPSC attempts must be a number between 0 and 20.");
    }

    setSaving(true);
    try {
      const { data } = await supabaseClient.auth.getSession();
      const session = data.session;
      if (!session) {
        router.replace(`/login?redirect=/onboarding`);
        return;
      }

      const userId = session.user.id;
      const userEmail = session.user.email ?? "";

      const payload = {
        id: userId,
        email: userEmail,
        full_name: fullName.trim(),
        phone: phone.trim(),
        state_of_preparation: stateOfPrep.trim(),
        upsc_attempts: attemptsNum,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabaseClient
        .from("profiles")
        .upsert(payload, { onConflict: "id" });

      if (error) throw error;

      setMsg("Saved ✅ Redirecting…");
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
        <div className="max-w-md mx-auto text-sm text-slate-400">
          Loading onboarding…
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-md mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Onboarding</h1>
          <p className="text-sm text-slate-400 mt-1">
            Add a few details to personalize practice.
          </p>
        </header>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
          <div className="text-xs text-slate-400">
            Logged in as: <span className="text-slate-200">{email || "—"}</span>
          </div>

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
              placeholder="10-digit number"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              State of preparation
            </span>
            <input
              value={stateOfPrep}
              onChange={(e) => setStateOfPrep(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm"
              placeholder="e.g., Delhi / Bihar / Kerala"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              UPSC attempts
            </span>
            <input
              value={attempts}
              onChange={(e) => setAttempts(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm"
              placeholder="0"
              inputMode="numeric"
            />
          </label>

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
            onClick={onSave}
            disabled={saving}
            className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save & Continue"}
          </button>

          <p className="text-xs text-slate-500">
            Redirect after onboarding:{" "}
            <span className="text-slate-300">{redirectTo}</span>
          </p>
        </div>
      </div>
    </main>
  );
}
