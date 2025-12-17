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

type SubjectStat = {
  subject: string;
  total: number;
  correct: number;
  accuracy: number; // 0..100 (rounded)
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

  // Perf stats
  const [statsLoading, setStatsLoading] = useState(false);
  const [totalAttempts, setTotalAttempts] = useState<number>(0);
  const [correctAttempts, setCorrectAttempts] = useState<number>(0);
  const [lastAttemptAt, setLastAttemptAt] = useState<string | null>(null);

  // Subject-wise stats
  const [subjectLoading, setSubjectLoading] = useState(false);
  const [subjectStats, setSubjectStats] = useState<SubjectStat[]>([]);

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

  // Load performance + subject stats only when tab is opened
  useEffect(() => {
    let cancelled = false;

    async function loadPerformanceAndSubjects() {
      if (tab !== "performance") return;

      setStatsLoading(true);
      setSubjectLoading(true);
      setErr(null);

      const { data: uData, error: uErr } = await supabaseClient.auth.getUser();
      if (uErr) {
        if (!cancelled) setErr(uErr.message);
        if (!cancelled) {
          setStatsLoading(false);
          setSubjectLoading(false);
        }
        return;
      }

      const userId = uData.user?.id;
      if (!userId) {
        router.replace("/login?redirect=/profile");
        return;
      }

      // -------------------
      // 1) Performance cards
      // -------------------
      try {
        const totalRes = await supabaseClient
          .from("question_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);

        if (totalRes.error) throw totalRes.error;

        const correctRes = await supabaseClient
          .from("question_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("is_correct", true);

        if (correctRes.error) throw correctRes.error;

        const lastRes = await supabaseClient
          .from("question_attempts")
          .select("created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (lastRes.error) throw lastRes.error;

        if (!cancelled) {
          setTotalAttempts(totalRes.count ?? 0);
          setCorrectAttempts(correctRes.count ?? 0);
          setLastAttemptAt(lastRes.data?.[0]?.created_at ?? null);
        }
      } catch (e: any) {
        if (!cancelled)
          setErr(e?.message ?? "Failed to load performance stats.");
      } finally {
        if (!cancelled) setStatsLoading(false);
      }

      // -------------------
      // 2) Subject-wise stats (NO JOIN)
      // -------------------
      try {
        const attemptsRes = await supabaseClient
          .from("question_attempts")
          .select("question_id,is_correct")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(5000);

        if (attemptsRes.error) throw attemptsRes.error;

        const attempts =
          (attemptsRes.data as Array<{
            question_id: number;
            is_correct: boolean | null;
          }>) ?? [];

        const questionIds = Array.from(
          new Set(attempts.map((a) => a.question_id).filter(Boolean))
        );

        if (questionIds.length === 0) {
          if (!cancelled) setSubjectStats([]);
          return;
        }

        const questionsRes = await supabaseClient
          .from("questions")
          .select("id,subject")
          .in("id", questionIds);

        if (questionsRes.error) throw questionsRes.error;

        const qRows =
          (questionsRes.data as Array<{ id: number; subject: string | null }>) ??
          [];

        const qidToSubject = new Map<number, string>();
        for (const q of qRows) {
          const subj = (q.subject ?? "Unknown").trim() || "Unknown";
          qidToSubject.set(q.id, subj);
        }

        const map = new Map<string, { total: number; correct: number }>();

        for (const a of attempts) {
          const subject = qidToSubject.get(a.question_id) ?? "Unknown";
          const prev = map.get(subject) ?? { total: 0, correct: 0 };
          prev.total += 1;
          if (a.is_correct) prev.correct += 1;
          map.set(subject, prev);
        }

        const list = Array.from(map.entries())
          .map(([subject, v]) => ({
            subject,
            total: v.total,
            correct: v.correct,
            accuracy: v.total ? Math.round((v.correct / v.total) * 100) : 0,
          }))
          .sort((a, b) => b.total - a.total || b.accuracy - a.accuracy);

        if (!cancelled) setSubjectStats(list);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load subject stats.");
      } finally {
        if (!cancelled) setSubjectLoading(false);
      }
    }

    loadPerformanceAndSubjects();

    return () => {
      cancelled = true;
    };
  }, [tab, router]);

  const onLogout = async () => {
    await supabaseClient.auth.signOut();
    router.replace("/login?redirect=/practice");
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
        <div className="max-w-4xl mx-auto text-sm text-slate-400">
          Loading profile…
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs tracking-widest text-slate-400">UPSC AI</div>
            <h1 className="text-3xl font-semibold">My Profile</h1>
            <p className="text-sm text-slate-400">
              General info now. Performance tab will be added next.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/practice"
              className="rounded-md bg-slate-900 border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Back to Practice
            </Link>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-md bg-slate-900 border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Logout
            </button>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex items-center gap-2">
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

        {err ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {err}
          </div>
        ) : null}

        {/* Content */}
        {tab === "general" ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="text-lg font-semibold">
              Onboarding details (read-only)
            </div>

            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/30 p-4">
              <FieldRow label="Email" value={profile?.email} />
              <FieldRow label="Full Name" value={profile?.full_name} />
              <FieldRow label="Phone" value={profile?.phone} />
              <FieldRow
                label="State of Preparation"
                value={profile?.state_of_preparation}
              />
              <FieldRow
                label="UPSC Attempts"
                value={
                  profile?.upsc_attempts != null
                    ? String(profile.upsc_attempts)
                    : "—"
                }
              />
            </div>

            <div className="mt-4 text-xs text-slate-400">
              Edit flow will be added later.
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="space-y-1">
              <div className="text-lg font-semibold">Performance (v1)</div>
              <div className="text-sm text-slate-400">
                High-signal summary of your attempts. Subject-wise and charts
                coming next.
              </div>
            </div>

            {/* Top stat cards */}
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                label="Total Attempts"
                value={statsLoading ? "…" : String(totalAttempts)}
              />
              <StatCard
                label="Correct"
                value={statsLoading ? "…" : String(correctAttempts)}
              />
              <StatCard
                label="Accuracy"
                value={statsLoading ? "…" : `${accuracyPct}%`}
                sub="Rounded"
              />
              <StatCard
                label="Last Attempt"
                value={
                  statsLoading
                    ? "…"
                    : lastAttemptAt
                    ? formatDateTime(lastAttemptAt)
                    : "—"
                }
              />
            </div>

            {/* Subject-wise Attempts */}
            <div className="mt-6">
              <div className="text-sm font-semibold text-slate-100">
                Subject-wise Attempts (v1)
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Total / Correct / Accuracy by subject (question_attempts + questions).
              </div>

              <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/30 overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-4 py-3 text-xs uppercase tracking-wide text-slate-400 border-b border-slate-800/70">
                  <div className="col-span-6">Subject</div>
                  <div className="col-span-2 text-right">Attempts</div>
                  <div className="col-span-2 text-right">Correct</div>
                  <div className="col-span-2 text-right">Accuracy</div>
                </div>

                {subjectLoading ? (
                  <div className="px-4 py-4 text-sm text-slate-400">
                    Loading subject-wise stats…
                  </div>
                ) : subjectStats.length === 0 ? (
                  <div className="px-4 py-4 text-sm text-slate-400">
                    No attempts yet. Solve a few questions and come back here.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/60">
                    {subjectStats.map((s) => (
                      <div
                        key={s.subject}
                        className="grid grid-cols-12 gap-2 px-4 py-3 text-sm"
                      >
                        <div className="col-span-6 text-slate-100">
                          {s.subject}
                        </div>
                        <div className="col-span-2 text-right text-slate-200">
                          {s.total}
                        </div>
                        <div className="col-span-2 text-right text-slate-200">
                          {s.correct}
                        </div>
                        <div className="col-span-2 text-right">
                          <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/40 px-2 py-0.5 text-xs text-slate-200">
                            {s.accuracy}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-3 text-xs text-slate-400">
                Next: charts + trendline + weak-subject suggestions.
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
