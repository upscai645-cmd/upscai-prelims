// app/practice/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";
import type { QuestionAnalysisV1, StatementVerdict, SourceRef } from "@/lib/aiAnalysis";
import { normalizeQuestionAnalysisV1 } from "@/lib/aiAnalysis";
import Link from "next/link";


/* ---------- Question row from Supabase ---------- */
type QuestionRow = {
  id: number;
  year: number | null;
  subject: string | null;
  question_number: number | null;
  question_text: string;

  option_a: string | null;
  option_b: string | null;
  option_c: string | null;
  option_d: string | null;
  correct_option: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  state_of_preparation: string | null;
  upsc_attempts: number | null;
};

const PRACTICE_PATH = "/practice";

/* ---------- Small UI helpers ---------- */
function Pill({
  text,
  tone,
}: {
  text: string;
  tone: "neutral" | "good" | "bad" | "warn";
}) {
  const cls =
    tone === "good"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : tone === "bad"
      ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
      : tone === "warn"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
      : "border-slate-600 bg-slate-900/60 text-slate-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${cls}`}>
      {text}
    </span>
  );
}

function verdictToTone(v: StatementVerdict): "good" | "bad" | "warn" {
  if (v === "correct") return "good";
  if (v === "incorrect") return "bad";
  return "warn";
}

function verdictLabel(v: StatementVerdict) {
  if (v === "correct") return "CORRECT";
  if (v === "incorrect") return "INCORRECT";
  return "UNKNOWN";
}

function renderSourceInline(source?: SourceRef) {
  if (!source) return null;
  const name = source.name ?? "Other";
  const pointer = source.pointer ?? "";
  const url = source.url;

  const text = pointer ? `${name} • ${pointer}` : `${name}`;
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-white/20 underline-offset-2 hover:decoration-white/50"
      >
        {text}
      </a>
    );
  }
  return <span>{text}</span>;
}

export default function PracticePage() {
  const router = useRouter();

  // auth + profile gate
  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // data
  const [allQuestions, setAllQuestions] = useState<QuestionRow[]>([]);
  const [loadingQuestion, setLoadingQuestion] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [yearFilter, setYearFilter] = useState<string>("All");
  const [subjectFilter, setSubjectFilter] = useState<string>("All");

  // navigation on filtered list
  const [questionIndex, setQuestionIndex] = useState(0);

  // attempt + analysis
  const [selected, setSelected] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [analysis, setAnalysis] = useState<QuestionAnalysisV1 | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  // analysis tabs
  const [activeTab, setActiveTab] = useState<"solution" | "strategy">("solution");

  const isProfileComplete = (p: ProfileRow | null) => {
    if (!p) return false;
    const fullNameOk = !!p.full_name && p.full_name.trim().length >= 2;
    const phoneOk = !!p.phone && p.phone.trim().length >= 8; // loose check
    const stateOk = !!p.state_of_preparation && p.state_of_preparation.trim().length >= 2;
    const attemptsOk = typeof p.upsc_attempts === "number" && p.upsc_attempts >= 0;
    return fullNameOk && phoneOk && stateOk && attemptsOk;
  };

  const resetAttemptState = () => {
    setSelected(null);
    setIsCorrect(null);
    setAnalysis(null);
    setActiveTab("solution");
    setError(null);
  };

  /* ======================================================
     AUTH + ONBOARDING GUARD
     ====================================================== */
  useEffect(() => {
    let alive = true;

    const goLogin = () => router.replace(`/login?redirect=${encodeURIComponent(PRACTICE_PATH)}`);
    const goOnboarding = () =>
      router.replace(`/onboarding?redirect=${encodeURIComponent(PRACTICE_PATH)}`);

    const checkAuthAndProfile = async () => {
      try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const session = sessionData.session;

        if (!session) {
          goLogin();
          return;
        }

        const { data: userData, error: userErr } = await supabaseClient.auth.getUser();
        if (userErr || !userData.user) {
          goLogin();
          return;
        }

        const uid = userData.user.id;
        if (alive) setUserId(uid);

        const { data: profile, error: profileErr } = await supabaseClient
          .from("profiles")
          .select("*")
          .eq("id", uid)
          .maybeSingle();

        if (profileErr) {
          console.error("Profile fetch error:", profileErr);
          goLogin();
          return;
        }

        if (!isProfileComplete((profile ?? null) as ProfileRow | null)) {
          goOnboarding();
          return;
        }

        if (alive) setAuthChecked(true);
      } catch (e) {
        console.error("Auth/profile guard error:", e);
        goLogin();
      }
    };

    checkAuthAndProfile();

    const { data: sub } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace(`/login?redirect=${encodeURIComponent(PRACTICE_PATH)}`);
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, [router]);

  /* ======================================================
     LOAD QUESTIONS
     ====================================================== */
  useEffect(() => {
    if (!authChecked) return;

    const load = async () => {
      setLoadingQuestion(true);
      setError(null);

      const { data, error } = await supabaseClient
        .from("questions")
        .select("*")
        .order("id", { ascending: true });

      if (error || !data) {
        console.error("Question load error:", error);
        setError("Failed to load questions.");
        setLoadingQuestion(false);
        return;
      }

      setAllQuestions(data as QuestionRow[]);
      setQuestionIndex(0);
      setLoadingQuestion(false);
    };

    load();
  }, [authChecked]);

  /* ======================================================
     FILTERS + DERIVED LISTS
     ====================================================== */
  const years = useMemo(() => {
    const ys = Array.from(
      new Set(allQuestions.map((q) => q.year).filter((x): x is number => !!x))
    ).sort((a, b) => b - a);
    return ["All", ...ys.map(String)];
  }, [allQuestions]);

  const subjects = useMemo(() => {
    const ss = Array.from(new Set(allQuestions.map((q) => q.subject).filter((x): x is string => !!x)))
      .sort();
    return ["All", ...ss];
  }, [allQuestions]);

  const filteredQuestions = useMemo(() => {
    return allQuestions.filter((q) => {
      const yOk = yearFilter === "All" || String(q.year ?? "") === yearFilter;
      const sOk = subjectFilter === "All" || (q.subject ?? "") === subjectFilter;
      return yOk && sOk;
    });
  }, [allQuestions, yearFilter, subjectFilter]);

  useEffect(() => {
    setQuestionIndex(0);
    resetAttemptState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearFilter, subjectFilter]);

  const question = filteredQuestions[questionIndex] ?? null;

  const currentOptions =
    question != null
      ? [
          { key: "A", label: question.option_a ?? "" },
          { key: "B", label: question.option_b ?? "" },
          { key: "C", label: question.option_c ?? "" },
          { key: "D", label: question.option_d ?? "" },
        ].filter((opt) => opt.label.trim().length > 0)
      : [];

  const correctKey = question?.correct_option?.trim().toUpperCase() ?? null;

  const handlePrev = () => {
    if (questionIndex <= 0) return;
    setQuestionIndex((i) => i - 1);
    resetAttemptState();
  };

  const handleNext = () => {
    if (questionIndex >= filteredQuestions.length - 1) return;
    setQuestionIndex((i) => i + 1);
    resetAttemptState();
  };

  const handleLogout = async () => {
    await supabaseClient.auth.signOut();
    router.replace(`/login?redirect=${encodeURIComponent(PRACTICE_PATH)}`);
  };

  /* ======================================================
     CHECK + GENERATE ANALYSIS (ALSO INSERT ATTEMPT)
     ====================================================== */
  const handleCheckAndAnalyse = async () => {
    setError(null);
    setAnalysis(null);
    setIsCorrect(null);

    if (!question) return setError("Question not loaded yet.");
    if (!selected) return setError("Please choose an option first.");
    if (!correctKey) return setError("Correct option is not set for this question.");
    if (!userId) return setError("User not found. Please re-login.");

    const correct = selected === correctKey;
    setIsCorrect(correct);

    // Insert attempt (don’t block UI if it fails)
    try {
      const { error: insErr } = await supabaseClient.from("question_attempts").insert({
        user_id: userId,
        question_id: question.id,
        selected_option: selected,
        is_correct: correct,
      });
      if (insErr) console.error("question_attempts insert error:", insErr);
    } catch (e) {
      console.error("question_attempts insert exception:", e);
    }

    // Fetch analysis
    try {
      setLoadingAnalysis(true);
      const res = await fetch(`/test-ai?questionId=${question.id}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const raw = await res.json();
      setAnalysis(normalizeQuestionAnalysisV1(raw));
      setActiveTab("solution");
    } catch (e) {
      console.error("Failed to fetch AI analysis:", e);
      setError("Failed to fetch AI analysis. Please try again.");
    } finally {
      setLoadingAnalysis(false);
    }
  };

  // While auth/profile is being checked, keep it quiet (prevents flash)
  if (!authChecked) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
        <div className="max-w-4xl mx-auto text-sm text-slate-400">
          Checking session & profile…
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top header */}
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold">UPSC Practice</h1>
            <p className="text-sm text-slate-400 mt-1">
              Practice PYQs → check answer → see explanation.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCheckAndAnalyse}
              disabled={loadingAnalysis || loadingQuestion || !question}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {loadingAnalysis ? "Generating..." : "Check & Generate Analysis"}
            </button>

            <Link
              href="/profile"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900/60 hover:bg-slate-800"
              title="My Profile"
            >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="text-slate-200"
            >
            <path
              d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M20 21a8 8 0 1 0-16 0"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>


            <button
              onClick={handleLogout}
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
              type="button"
            >
              Logout
            </button>
          </div>
        </header>

        {/* Filters row + Prev/Next (as you want) */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-slate-400">Year</span>
                <select
                  value={yearFilter}
                  onChange={(e) => setYearFilter(e.target.value)}
                  className="bg-slate-950/60 border border-slate-700 rounded-md px-3 py-2 text-sm"
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-slate-400">Subject</span>
                <select
                  value={subjectFilter}
                  onChange={(e) => setSubjectFilter(e.target.value)}
                  className="min-w-[220px] bg-slate-950/60 border border-slate-700 rounded-md px-3 py-2 text-sm"
                >
                  {subjects.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-xs text-slate-400">
                Showing <span className="text-slate-200 font-semibold">{filteredQuestions.length}</span>{" "}
                of <span className="text-slate-200 font-semibold">{allQuestions.length}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrev}
                disabled={questionIndex <= 0}
                className="rounded-md border border-slate-700 bg-slate-950/30 px-4 py-2 text-sm hover:bg-slate-900 disabled:opacity-40"
              >
                ← Previous
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={questionIndex >= filteredQuestions.length - 1}
                className="rounded-md border border-slate-700 bg-slate-950/30 px-4 py-2 text-sm hover:bg-slate-900 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        </section>

        {/* Question */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          {loadingQuestion && <p className="text-sm text-slate-400">Loading questions…</p>}

          {!loadingQuestion && question && (
            <>
              <div className="text-xs text-slate-400 mb-2">
                {question.year ? `${question.year}` : "Year —"}{" "}
                {question.subject ? `• ${question.subject}` : ""}{" "}
                {question.question_number ? `• Q${question.question_number}` : ""}
              </div>

              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                {question.question_text}
              </pre>

              <div className="mt-4 space-y-2">
                {currentOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setSelected(opt.key)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
                      selected === opt.key
                        ? "border-emerald-400 bg-emerald-500/10"
                        : "border-slate-700 bg-slate-900 hover:border-slate-500"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 text-xs font-semibold">
                        {opt.key}
                      </span>
                      <span>{opt.label}</span>
                    </span>
                  </button>
                ))}
              </div>

              {isCorrect !== null && correctKey && (
                <div
                  className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                    isCorrect
                      ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40"
                      : "bg-rose-500/10 text-rose-300 border border-rose-500/40"
                  }`}
                >
                  {isCorrect
                    ? `✅ Correct! The right option is ${correctKey}.`
                    : `❌ Not quite. The correct option is ${correctKey}.`}
                </div>
              )}

              {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
            </>
          )}

          {!loadingQuestion && !question && !error && (
            <p className="text-sm text-rose-400">No question found for this filter.</p>
          )}
        </section>

        {/* Analysis */}
        {analysis && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-lg font-semibold">Solution & Guidance</div>
                <div className="text-sm text-slate-400">
                  Clean UI view of the generated analysis (no raw JSON).
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("solution")}
                  className={`px-4 py-2 text-sm rounded-md border transition-colors ${
                    activeTab === "solution"
                      ? "bg-emerald-500 text-slate-950 border-emerald-500"
                      : "bg-slate-900 text-slate-300 border-slate-600 hover:bg-slate-800"
                  }`}
                >
                  Solution & Explanation
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("strategy")}
                  className={`px-4 py-2 text-sm rounded-md border transition-colors ${
                    activeTab === "strategy"
                      ? "bg-emerald-500 text-slate-950 border-emerald-500"
                      : "bg-slate-900 text-slate-300 border-slate-600 hover:bg-slate-800"
                  }`}
                >
                  Exam Strategy
                </button>
              </div>
            </div>

            {activeTab === "solution" ? (
              <SolutionTab analysis={analysis} />
            ) : (
              <StrategyTab analysis={analysis} />
            )}
          </section>
        )}
      </div>
    </main>
  );
}

/* ======================================================
   Solution Tab
   ====================================================== */

function SolutionTab({ analysis }: { analysis: QuestionAnalysisV1 }) {
  const topicTitle = analysis?.topic_brief?.title ?? "Topic Brief";
  const topicBullets = analysis?.topic_brief?.bullets ?? [];
  const correctAnswer = analysis?.correct_answer ?? "—";
  const statements = analysis?.statements ?? [];

  return (
    <div className="mt-5 space-y-5">
      {/* Correct Answer */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-emerald-200">
          Correct Answer
        </div>
        <div className="mt-1 text-xl font-semibold text-emerald-100">
          {String(correctAnswer).toUpperCase()}
        </div>
      </div>

      {/* Topic Brief */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Topic Brief
        </div>
        <div className="mt-2 text-sm font-medium text-slate-100">{topicTitle}</div>

        {topicBullets.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-200 space-y-1">
            {topicBullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 text-sm text-slate-400">No bullets generated.</div>
        )}
      </div>

      {/* Statement-wise breakdown */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Statement-wise Breakdown
        </div>

        <div className="mt-3 space-y-3">
          {statements.length === 0 && (
            <div className="text-sm text-slate-400">No statement blocks generated.</div>
          )}

          {statements.map((st) => (
            <div key={st.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-100">Statement {st.id}</div>
                <Pill text={verdictLabel(st.verdict)} tone={verdictToTone(st.verdict)} />
              </div>

              <div className="mt-3 space-y-3">
                {(st.facts ?? []).map((f, idx) => (
                  <div key={idx} className="rounded-lg border border-slate-800 bg-slate-950/30 p-3">
                    <div className="text-sm text-slate-100">{f.fact}</div>

                    {f.example && (
                      <div className="mt-2 text-sm text-slate-200">
                        <span className="font-semibold text-slate-300">Example:</span>{" "}
                        {f.example}
                      </div>
                    )}

                    {/* ✅ FIX: SourceRef has name + pointer (NOT label) */}
                    <div className="mt-2 text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">Source:</span>{" "}
                      {renderSourceInline(f.source)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ======================================================
   Strategy Tab
   ====================================================== */

function StrategyTab({ analysis }: { analysis: QuestionAnalysisV1 }) {
  const difficulty = analysis?.strategy?.difficulty;
  const level = difficulty?.level ?? "moderate";
  const why = difficulty?.why ?? [];

  const examStrategy = analysis?.strategy?.exam_strategy ?? [];
  const logical = analysis?.strategy?.logical_deduction ?? [];
  const verdict = analysis?.strategy?.ai_verdict;

  return (
    <div className="mt-5 space-y-4">
      {/* Difficulty */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Difficulty
          </div>
          <Pill text={String(level).toUpperCase()} tone="neutral" />
        </div>

        {why.length > 0 ? (
          <ul className="mt-3 list-disc pl-5 text-sm text-slate-200 space-y-1">
            {why.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 text-sm text-slate-400">No difficulty rationale provided.</div>
        )}
      </div>

      {/* Exam Strategy */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          What to do in the exam
        </div>

        {examStrategy.length > 0 ? (
          <ul className="mt-3 list-disc pl-5 text-sm text-slate-200 space-y-1">
            {examStrategy.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 text-sm text-slate-400">
            No “exam_strategy” generated yet.
          </div>
        )}
      </div>

      {/* Logical Deduction */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Logical deduction & elimination
        </div>

        {logical.length > 0 ? (
          <ul className="mt-3 list-disc pl-5 text-sm text-slate-200 space-y-1">
            {logical.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 text-sm text-slate-400">No “logical_deduction” generated yet.</div>
        )}
      </div>

      {/* AI Verdict (NO CONFIDENCE SHOWN) */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          AI Verdict
        </div>

        {verdict ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill
                text={`Recommendation: ${String(verdict.recommendation).toUpperCase()}`}
                tone="neutral"
              />
              {/* ⛔ intentionally hiding confidence */}
            </div>

            {verdict.rationale ? (
              <div className="text-sm text-slate-200">{verdict.rationale}</div>
            ) : (
              <div className="text-sm text-slate-400">No rationale provided.</div>
            )}
          </div>
        ) : (
          <div className="mt-2 text-sm text-slate-400">No verdict generated yet.</div>
        )}
      </div>
    </div>
  );
}
