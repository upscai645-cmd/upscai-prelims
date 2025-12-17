"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  state_of_preparation: string | null;
  upsc_attempts: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export default function ProfilePage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"general" | "analytics">("general");

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const boot = async () => {
      setErr(null);
      setLoading(true);

      try {
        const { data } = await supabaseClient.auth.getSession();
        const session = data.session;

        if (!session) {
          router.replace("/login?redirect=/profile");
          return;
        }

        if (alive) setAuthChecked(true);

        // Fetch profile
        const { data: p, error } = await supabaseClient
          .from("profiles")
          .select(
            "id,email,full_name,phone,state_of_preparation,upsc_attempts,created_at,updated_at"
          )
          .eq("id", session.user.id)
          .single();

        if (error) {
          // If row missing, show a helpful message (onboarding should create it, but just in case)
          setProfile(null);
          setErr(
            "Profile not found. Please complete onboarding first (or try logging out/in once)."
          );
        } else {
          setProfile(p as ProfileRow);
        }
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load profile.");
      } finally {
        if (alive) setLoading(false);
      }
    };

    boot();

    const { data: sub } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login?redirect=/profile");
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, [router]);

  const display = useMemo(() => {
    const p = profile;
    return {
      email: p?.email ?? "—",
      name: p?.full_name ?? "—",
      phone: p?.phone ?? "—",
      state: p?.state_of_preparation ?? "—",
      attempts:
        typeof p?.upsc_attempts === "number" ? String(p.upsc_attempts) : "—",
    };
  }, [profile]);

  const onLogout = async () => {
    await supabaseClient.auth.signOut();
    router.replace("/login");
  };

  if (!authChecked) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
        <div className="max-w-3xl mx-auto text-sm text-slate-400">
          Checking session…
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs tracking-widest text-slate-400">UPSC AI</div>
            <h1 className="text-2xl md:text-3xl font-semibold">My Profile</h1>
            <p className="text-sm text-slate-400">
              General info now. Performance tab will be added next.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push("/practice")}
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Back to Practice
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Logout
            </button>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-800 pb-2">
          <button
            type="button"
            onClick={() => setTab("general")}
            className={`px-4 py-2 text-sm rounded-md border transition-colors ${
              tab === "general"
                ? "bg-emerald-500 text-slate-950 border-emerald-500"
                : "bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800"
            }`}
          >
            General Info
          </button>

          <button
            type="button"
            onClick={() => setTab("analytics")}
            className={`px-4 py-2 text-sm rounded-md border transition-colors ${
              tab === "analytics"
                ? "bg-emerald-500 text-slate-950 border-emerald-500"
                : "bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800"
            }`}
          >
            Performance & Analytics
          </button>
        </div>

        {/* Content */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          {loading && <div className="text-sm text-slate-400">Loading…</div>}

          {!loading && err && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {err}
            </div>
          )}

          {!loading && !err && tab === "general" && (
            <div className="space-y-4">
              <div className="text-sm font-semibold text-slate-200">
                Onboarding details (read-only)
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <InfoCard label="Email" value={display.email} />
                <InfoCard label="Full name" value={display.name} />
                <InfoCard label="Phone" value={display.phone} />
                <InfoCard label="State of preparation" value={display.state} />
                <InfoCard label="UPSC attempts" value={display.attempts} />
              </div>

              <div className="text-xs text-slate-500">
                Edit flow will be added later.
              </div>
            </div>
          )}

          {!loading && !err && tab === "analytics" && (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-200">
                Performance & Analytics
              </div>
              <div className="text-sm text-slate-400">
                Placeholder for now. Next we’ll show attempts, accuracy, subject-wise stats,
                and “resume last session”.
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm text-slate-100">{value}</div>
    </div>
  );
}
