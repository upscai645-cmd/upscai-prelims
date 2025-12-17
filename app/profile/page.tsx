"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

type Tab = "general" | "performance";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  state_of_preparation: string | null;
  upsc_attempts: number | null;
};

function Pill({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-md border px-4 py-2 text-sm",
        active
          ? "bg-emerald-500 text-slate-950 border-emerald-400"
          : "bg-slate-900/40 text-slate-200 border-slate-700 hover:bg-slate-800/60",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-slate-800/70 py-3 last:border-b-0">
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="text-sm text-slate-100">{value || "—"}</div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-50">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-400">{sub}</div> : null}
    </div>
  );
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  // simple + readable (local time)
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ProfilePage() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("general");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProfileRow | null>(null);

  // Perf stats (Step 3.1)
  const [statsLoading, setStatsLoading] = useState(false);
  const [totalAttempts, setTotalAttempts] = useState<number>(0);
  const [correctAttempts, setCorrectAttempts] = useState<number>(0);
  const [lastAttemptAt, setLastAttemptAt] = useState<string | null>(null);

  const accuracyPct = useMemo(() => {
    if (!totalAttempts) return 0;
    return Math.round((correctAttempts / totalAttempts) * 100);
  }, [totalAttempts, correctAttempts]);

  // Boot: ensure session + load profile
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setLoading(true);
      setErr(null);

      const { data, error } = await supabaseClient.auth.getUser();
      if (error) {
        if (!cancelled) setErr(error.message);
        if (!cancelled) setLoading(false);
        return;
      }

      const user = data.user;
      if (!user) {
        router.replace("/login?redirect=/profile");
        return;
      }

      // Load onboarding profile row
      const { data: prof, error: profErr } = await supabaseClient
        .from("profiles")
        .select("id,email,full_name,phone,state_of_preparation,upsc_attempts")
        .eq("id", user.id)
        .maybeSingle();

      if (profErr) {
        if (!cancelled) setErr(profErr.message);
      } else {
        if (!cancelled) setProfile((prof as ProfileRow) || null);
      }

      if (!cancelled) setLoading(false);
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Load performance stats only when performance tab is opened (efficient)
  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      if (tab !== "performance") return;
      setStatsLoading(true);
      setErr(null);

      const { data: u } = await supabaseClient.auth.getUser();
      const userId = u.user?.id;
      if (!userId) {
        router.replace("/login?redirect=/profile");
        return;
      }

      try {
        // 1) Total attempts (COUNT only)
        const totalRes = await supabaseClient
          .from("question_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);

        if (totalRes.error) throw totalRes.error;
        const total = totalRes.count ?? 0;

        // 2) Correct attempts (COUNT only)
        const correctRes = await supabaseClient
          .from("question_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("is_correct", true);

        if (correctRes.error) throw correctRes.error;
        const correct = correctRes.count ?? 0;

        // 3) Last attempted
        const lastRes = await supabaseClient
          .from("question_attempts")
          .select("created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (lastRes.error) throw lastRes.error;
        const last = lastRes.data?.[0]?.created_at ?? null;

        if (!cancelled) {
          setTotalAttempts(total);
          setCorrectAttempts(correct);
          setLastAttemptAt(last);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load performance.");
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }

    loadStats();
    return () => {
      cancelled = true;
    };
  }, [tab, router]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            Loading profile…
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="text-xs tracking-widest text-slate-400">UPSC AI</div>
            <h1 className="text-4xl font-semibold">My Profile</h1>
            <p className="text-sm text-slate-400">
              General info now. Performance tab will be added next.
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              href="/practice"
              className="rounded-md bg-slate-900 border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Back to Practice
            </Link>
            <Link
              href="/logout"
              className="rounded-md bg-slate-900 border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Logout
            </Link>
          </div>
        </header>

        <div className="flex gap-2">
          <Pill active={tab === "general"} onClick={() => setTab("general")}>
            General Info
          </Pill>
          <Pill
            active={tab === "performance"}
            onClick={() => setTab("performance")}
          >
            Performance &amp; Analytics
          </Pill>
        </div>

        {err && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {err}
          </div>
        )}

        <div className="h-px bg-slate-800/70" />

        {tab === "general" ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold">Onboarding details (read-only)</h2>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <FieldRow label="Email" value={profile?.email} />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <FieldRow label="Full Name" value={profile?.full_name} />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <FieldRow label="Phone" value={profile?.phone} />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <FieldRow
                  label="State of Preparation"
                  value={profile?.state_of_preparation}
                />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4 md:col-span-2">
                <FieldRow
                  label="UPSC Attempts"
                  value={
                    typeof profile?.upsc_attempts === "number"
                      ? String(profile.upsc_attempts)
                      : null
                  }
                />
              </div>
            </div>

            <p className="mt-4 text-xs text-slate-500">
              Edit flow will be added later.
            </p>
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold">Performance (v1)</h2>
            <p className="mt-1 text-sm text-slate-400">
              High-signal summary of your attempts. Subject-wise and charts coming next.
            </p>

            {statsLoading ? (
              <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/30 p-4 text-sm text-slate-300">
                Loading performance…
              </div>
            ) : totalAttempts === 0 ? (
              <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/30 p-4 text-sm text-slate-300">
                No attempts yet. Go to{" "}
                <Link href="/practice" className="text-emerald-300 hover:underline">
                  Practice
                </Link>{" "}
                and answer a question to see your stats here.
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Total Attempts"
                  value={String(totalAttempts)}
                />
                <StatCard
                  label="Correct"
                  value={String(correctAttempts)}
                />
                <StatCard
                  label="Accuracy"
                  value={`${accuracyPct}%`}
                  sub="Rounded"
                />
                <StatCard
                  label="Last Attempt"
                  value={lastAttemptAt ? formatDateTime(lastAttemptAt) : "—"}
                />
              </div>
            )}

            <div className="mt-4 text-xs text-slate-500">
              Next: subject-wise attempts + charts.
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
