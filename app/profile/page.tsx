"use client";

import React, { useEffect, useMemo, useState } from "react";
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
  attempts: number;
  correct: number;
  accuracyPct: number; // 0..100
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

const SUBJECT_PLAYBOOK: Record<string, string[]> = {
  "ECONOMICS": [
    "Revise NCERT XI–XII basics + 1-page notes for key terms (inflation, GDP, BoP, fiscal deficit).",
    "Make a “committees + indices + schemes” cheat sheet (FRBM, MPC, CPI/WPI, GDP deflator).",
    "Solve 20 PYQs + reattempt wrong ones after 48 hours (error-log).",
  ],
  "CURRENT EVENTS": [
    "Maintain monthly CA sheets: Polity/Gov, Economy, S&T, Env, IR (1 page each).",
    "For every wrong Q: write the static anchor (Act/Article, index, place, institution).",
    "Re-solve last 2 years PYQs of this subject weekly.",
  ],
  "POLITY": [
    "Articles + schedules + bodies: flashcards + weekly revision.",
    "SC doctrines/landmark cases: 1-liner each.",
    "PYQ drill: statement-based elimination practice.",
  ],
  "ENVIRONMENT": [
    "Maps + protected areas + species lists (IUCN/CITES) quick revision.",
    "Conventions/protocols: 1 page (COPs, UNFCCC, CBD, Ramsar).",
    "20 PYQs + focus on tricky statements.",
  ],
  "SCIENCE & TECH": [
    "Make 1-pagers for biotech/space/IT/defence terms.",
    "Maintain error-log: why your option was wrong (UPSC traps).",
    "Reattempt wrong PYQs after 48 hours.",
  ],
  "ANCIENT & MEDIEVAL": [
    "Timeline + themes (art/culture, admin, economy) 1-pagers.",
    "Source-based facts (inscriptions/texts) flashcards.",
    "PYQ set + reattempt wrong ones.",
  ],
  "MODERN HISTORY": [
    "Timeline (1857→1947) + personalities/acts 1-pagers.",
    "Movements: causes-methods-outcomes (3-liner each).",
    "PYQ drill + reattempt wrong ones.",
  ],
  "GEOGRAPHY": [
    "Maps practice + physical processes basics.",
    "Climatic phenomena + Indian regions revision.",
    "PYQ statement elimination + diagram memory.",
  ],
  "__default": [
    "30-min concept revision + 20 PYQs.",
    "Note missed anchor facts (definitions/lists/committees/dates).",
    "Reattempt wrong PYQs after 48 hours.",
  ],
};

export default function ProfilePage() {
  const router = useRouter();

  // --- knobs (as you set) ---
  const N = 5;
  const T = 60;

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

  // ✅ Weak-subject suggestions (Step 1–7 rolled in)
  const weakSubjects = useMemo(() => {
    const weak = subjectStats
      .filter((s) => s.attempts > 0 && s.accuracyPct < T)
      .sort((a, b) => a.accuracyPct - b.accuracyPct)
      .slice(0, N);

    return weak;
  }, [subjectStats, N, T]);

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

  // Load performance + subjects ONLY when performance tab is opened
  useEffect(() => {
    let cancelled = false;

    async function loadPerformanceAndSubjects() {
      if (tab !== "performance") return;

      setStatsLoading(true);
      setSubjectLoading(true);
      setErr(null);

      const { data: u } = await supabaseClient.auth.getUser();
      const userId = u.user?.id;

      if (!userId) {
        router.replace("/login?redirect=/profile");
        return;
      }

      try {
        // Pull attempts with joined question subject
        const { data: attempts, error: aErr } = await supabaseClient
          .from("question_attempts")
          .select("is_correct, created_at, questions(subject)")
          .eq("user_id", userId);

        if (aErr) throw aErr;

        const rows =
          (attempts as Array<{
            is_correct: boolean | null;
            created_at: string;
            questions: { subject: string | null } | null;
          }>) || [];

        const total = rows.length;
        const correct = rows.filter((r) => r.is_correct === true).length;

        let last: string | null = null;
        for (const r of rows) {
          if (!last || new Date(r.created_at).getTime() > new Date(last).getTime()) {
            last = r.created_at;
          }
        }

        // Build subject stats
        const map = new Map<string, { attempts: number; correct: number }>();
        for (const r of rows) {
          const subject = (r.questions?.subject || "Unknown").trim();
          const cur = map.get(subject) || { attempts: 0, correct: 0 };
          cur.attempts += 1;
          if (r.is_correct === true) cur.correct += 1;
          map.set(subject, cur);
        }

        const list: SubjectStat[] = Array.from(map.entries())
          .map(([subject, v]) => ({
            subject,
            attempts: v.attempts,
            correct: v.correct,
            accuracyPct: v.attempts ? Math.round((v.correct / v.attempts) * 100) : 0,
          }))
          .sort((a, b) => b.attempts - a.attempts);

        if (!cancelled) {
          setTotalAttempts(total);
          setCorrectAttempts(correct);
          setLastAttemptAt(last);
          setSubjectStats(list);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load performance.");
      } finally {
        if (!cancelled) {
          setStatsLoading(false);
          setSubjectLoading(false);
        }
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
              General info + performance snapshot.
            </p>
          </div>

          <div className="flex gap-2">
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

        <div className="flex gap-2">
          <Pill active={tab === "general"} onClick={() => setTab("general")}>
            General Info
          </Pill>
          <Pill active={tab === "performance"} onClick={() => setTab("performance")}>
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
            <h2 className="text-base font-semibold">
              Onboarding details (read-only)
            </h2>

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

            <p className="mt-4 text-xs text-slate-500">Edit flow will be added later.</p>
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold">Performance (v1)</h2>
            <p className="mt-1 text-sm text-slate-400">
              Overall + subject-wise + weak-subject suggestions (N={N}, T={T}%).
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
              <>
                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard label="Total Attempts" value={String(totalAttempts)} />
                  <StatCard label="Correct" value={String(correctAttempts)} />
                  <StatCard label="Accuracy" value={`${accuracyPct}%`} sub="Rounded" />
                  <StatCard
                    label="Last Attempt"
                    value={lastAttemptAt ? formatDateTime(lastAttemptAt) : "—"}
                  />
                </div>

                {/* ✅ Weak-subject suggestions */}
                <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/30 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">
                        Weak-subject suggestions
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        Picks up to {N} subjects with accuracy below {T}% (sorted worst-first).
                      </div>
                    </div>
                  </div>

                    {weakSubjects.map((s) => {
                      const subjectKey = (s.subject ?? "")
                        .toUpperCase()
                        .trim()
                        .replace(/\s+/g, " ");

                      const tips = SUBJECT_PLAYBOOK[subjectKey] ?? SUBJECT_PLAYBOOK["__default"];

                      return (
                        <div
                          key={s.subject}
                          className="rounded-xl border border-slate-800 bg-slate-900/30 p-4"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="text-sm font-semibold text-slate-100">
                              {s.subject || "Unknown"}
                            </div>

                            <div className="text-xs text-slate-400">
                              Attempts:{" "}
                              <span className="text-slate-200 font-medium">{s.attempts}</span>
                              {" · "}Accuracy:{" "}
                              <span className="text-rose-200 font-semibold">{s.accuracyPct}%</span>
                            </div>
                          </div>

                          <ul className="mt-3 list-disc pl-5 space-y-2 text-sm text-slate-200">
                            {tips.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                    </div>

                {/* Subject-wise table */}
                <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/30 p-5">
                  <div className="text-sm font-semibold text-slate-100">
                    Subject-wise attempts
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Sorted by attempts (desc).
                  </div>

                  {subjectLoading ? (
                    <div className="mt-4 text-sm text-slate-300">
                      Loading subject stats…
                    </div>
                  ) : subjectStats.length === 0 ? (
                    <div className="mt-4 text-sm text-slate-300">
                      No subject stats yet.
                    </div>
                  ) : (
                    <div className="mt-4 overflow-hidden rounded-xl border border-slate-800">
                      <div className="grid grid-cols-12 bg-slate-900/60 px-4 py-2 text-xs uppercase tracking-wide text-slate-400">
                        <div className="col-span-6">Subject</div>
                        <div className="col-span-2 text-right">Attempts</div>
                        <div className="col-span-2 text-right">Correct</div>
                        <div className="col-span-2 text-right">Accuracy</div>
                      </div>

                      {subjectStats.map((s) => (
                        <div
                          key={s.subject}
                          className="grid grid-cols-12 px-4 py-3 text-sm border-t border-slate-800/70"
                        >
                          <div className="col-span-6 text-slate-100">
                            {s.subject}
                          </div>
                          <div className="col-span-2 text-right text-slate-200">
                            {s.attempts}
                          </div>
                          <div className="col-span-2 text-right text-slate-200">
                            {s.correct}
                          </div>
                          <div className="col-span-2 text-right text-slate-200">
                            {s.accuracyPct}%
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
