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
  onboarded: boolean | null;
  is_pro: boolean | null;
};

export default function OnboardingClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const redirectTo = useMemo(() => sp.get("redirectTo") || "/practice", [sp]);

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");

  const [profile, setProfile] = useState<ProfileRow | null>(null);

  // form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [stateOfPrep, setStateOfPrep] = useState("");
  const [attempts, setAttempts] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isComplete = (p: ProfileRow) => {
    return (
      !!(p.full_name && p.full_name.trim()) &&
      !!(p.phone && p.phone.trim()) &&
      !!(p.state_of_preparation && p.state_of_preparation.trim()) &&
      typeof p.upsc_attempts === "number"
    );
  };

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);

      // 1) session
      const { data: s, error: sErr } = await supabaseClient.auth.getSession();

      // If you have bad/stale tokens in localStorage, Supabase can throw:
      // "Invalid Refresh Token: Refresh Token Not Found"
      if (sErr) {
        // clean out broken auth state and go to login
        try {
          await supabaseClient.auth.signOut();
        } catch {}
        if (alive) router.replace(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
        return;
      }

      const session = s.session;
      if (!session?.user) {
        if (alive) router.replace(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
        return;
      }

      const userId = session.user.id;
      const userEmail = session.user.email ?? "";
      if (alive) setEmail(userEmail);

      // 2) load profile
      const { data: prof, error: pErr } = await supabaseClient
        .from("profiles")
        .select("id,email,full_name,phone,state_of_preparation,upsc_attempts,onboarded,is_pro")
        .eq("id", userId)
        .maybeSingle();

      if (pErr) {
        if (alive) {
          setError(pErr.message);
          setLoading(false);
        }
        return;
      }

      // 3) If already complete => go onwards
      if (prof && isComplete(prof as ProfileRow)) {
        if (alive) router.replace(redirectTo);
        return;
      }

      // 4) Prefill form if profile exists but incomplete
      if (alive) {
        const row = (prof as ProfileRow) ?? null;
        setProfile(row);

        setFullName(row?.full_name ?? "");
        setPhone(row?.phone ?? "");
        setStateOfPrep(row?.state_of_preparation ?? "");
        setAttempts(
          typeof row?.upsc_attempts === "number" ? String(row.upsc_attempts) : ""
        );

        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [router, redirectTo]);

  const onSave = async () => {
    setError(null);

    const attemptsNum = Number(attempts);
    if (!fullName.trim()) return setError("Full name required");
    if (!phone.trim()) return setError("Phone required");
    if (!stateOfPrep.trim()) return setError("State of preparation required");
    if (!Number.isFinite(attemptsNum)) return setError("UPSC attempts must be a number");

    setSaving(true);
    try {
      const { data: s, error: sErr } = await supabaseClient.auth.getSession();
      if (sErr || !s.session?.user) {
        throw new Error("Session expired. Please login again.");
      }

      const userId = s.session.user.id;
      const userEmail = s.session.user.email ?? null;

      // Upsert so it works even if profile row wasn't created yet
      const { error: upErr } = await supabaseClient
        .from("profiles")
        .upsert(
          {
            id: userId,
            email: userEmail,
            full_name: fullName.trim(),
            phone: phone.trim(),
            state_of_preparation: stateOfPrep.trim(),
            upsc_attempts: attemptsNum,
            onboarded: true,
          },
          { onConflict: "id" }
        );

      if (upErr) throw upErr;

      router.replace(redirectTo);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-slate-200">
        Loading...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl p-6 text-slate-100">
      <h1 className="text-2xl font-semibold">Onboarding</h1>
      <p className="mt-1 text-sm text-slate-300">
        {email ? `Signed in as ${email}` : "Signed in"}
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-rose-700 bg-rose-900/30 p-3 text-sm">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-4">
        <div>
          <label className="text-sm text-slate-300">Full name</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g., Rohit Kumar"
          />
        </div>

        <div>
          <label className="text-sm text-slate-300">Phone</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g., 8529792690"
          />
        </div>

        <div>
          <label className="text-sm text-slate-300">State of preparation</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={stateOfPrep}
            onChange={(e) => setStateOfPrep(e.target.value)}
            placeholder="e.g., Delhi"
          />
        </div>

        <div>
          <label className="text-sm text-slate-300">UPSC attempts</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={attempts}
            onChange={(e) => setAttempts(e.target.value)}
            placeholder="e.g., 3"
            inputMode="numeric"
          />
        </div>

        <button
          onClick={onSave}
          disabled={saving}
          className="mt-2 inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 font-medium disabled:opacity-60"
        >
          {saving ? "Saving..." : "Continue"}
        </button>
      </div>

      {/* optional debug */}
      {profile && (
        <div className="mt-6 text-xs text-slate-400">
          <div>profile.id: {profile.id}</div>
          <div>profile.onboarded: {String(profile.onboarded)}</div>
          <div>profile.is_pro: {String(profile.is_pro)}</div>
        </div>
      )}
    </div>
  );
}
