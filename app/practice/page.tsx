// app/practice/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";
import type { QuestionAnalysisV1, StatementVerdict, SourceRef } from "@/lib/aiAnalysis";
import { normalizeQuestionAnalysisV1 } from "@/lib/aiAnalysis";

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

export default function PracticePage() {
  const router = useRouter();

  // auth + profile gate
  const [authChecked, setAuthChecked] = useState(false);

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

  const PRACTICE_PATH = "/practice";

  const isProfileComplete = (p: ProfileRow | null) => {
    if (!p) return false;
    const fullNameOk = !!p.full_name && p.full_name.trim().length >= 2;
    const phoneOk = !!p.phone && p.phone.trim().length >= 8; // loose check
    const stateOk = !!p.state_of_preparation && p.state_of_preparation.trim().length >= 2;
    const attemptsOk = typeof p.upsc_attempts === "number" && p.upsc_attempts >= 0;
    return fullNameOk && phoneOk && stateOk && attemptsOk;
  };

  /* ======================================================
     AUTH + ONBOARDING GUARD (MUST RUN FIRST)
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

        // Get user (reliable id + email)
        const { data: userData, error: userErr } = await supabaseClient.auth.getUser();
        if (userErr || !userData.user) {
          goLogin();
          return;
        }

        const userId = userData.user.id;
        const email = userData.user.email ?? null;

        // Fetch profile
        const { data: profile, error: profileErr } = await supabaseClient
          .from("profiles")
          .select("id,email,full_name,phone,state_of_preparation,upsc_attempts")
          .eq("id", userId)
          .maybeSingle();

        // If profile row doesn't exist yet, create a minimal one
        if (!profile && !profileErr) {
          const { error: insertErr } = await supabaseClient.from("profiles").insert({
            id: userId,
            email,
          });
          if (insertErr) {
            console.error("profiles insert error:", insertErr);
            // If insert fails due to RLS/mismatch, force onboarding anyway
            goOnboarding();
            return;
          }
          goOnboarding();
          return;
        }

        if (profileErr) {
          console.error("profiles select error:", profileErr);
          // If we cannot read profile due to RLS/config, send to onboarding (it will reveal the issue quickly)
          goOnboarding();
          return;
        }

        if (!isProfileComplete(profile as ProfileRow)) {
          goOnboarding();
          return;
        }

        if (alive) setAuthChecked(true);
      } catch (e) {
        console.error(e);
        goLogin();
      }
    };

    checkAuthAndProfile();

    // If user logs out in another tab, kick them out
    const { data: sub } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace(`/login?redirect=${encodeURIComponent(PRACTICE_PATH)}`);
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, [router]);

  /* ======================================================
     LOAD QUESTIONS (ONLY AFTER AUTH + PROFILE CHECK)
     ====================================================== */
  useEffect(() => {
    if (!authChecked) return;

    const loadQuestions = async () => {
      setError(null);
      setLoadingQuestion(true);

      try {
        const { data, error } = await supabaseClient
          .from("questions")
          .select("*")
          .order("id", { ascending: true });

        if (error || !data || data.length === 0) {
          console.error("Error fetching questions:", error);
          setError("Failed to load questions from Supabase.");
          return;
        }

        setAllQuestions(data as QuestionRow[]);
        setQuestionIndex(0);
      } catch (err) {
        console.error("Unexpected error fetching questions:", err);
        setError("Unexpected error while loading questions.");
      } finally {
        setLoadingQuestion(false);
      }
    };

    loadQuestions();
  }, [authChecked]);

  const years = useMemo(() => {
    const ys = Array.from(
      new Set(allQuestions.map((q) => q.year).filter((x): x is number => !!x))
    ).sort((a, b) => b - a);
    return ys;
  }, [allQuestions]);

  const subjects = useMemo(() => {
    const ss = Array.from(
      new Set(
        allQuestions
          .map((q) => q.subject?.trim())
          .filter((x): x is string => !!x && x.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));
    return ss;
  }, [allQuestions]);

  const filteredQuestions = useMemo(() => {
    return allQuestions.filter((q) => {
      const yearOk = yearFilter === "All" ? true : String(q.year ?? "") === yearFilter;
      const subjectOk =
        subjectFilter === "All" ? true : (q.subject ?? "").trim() === subjectFilter;
      return yearOk && subjectOk;
    });
  }, [allQuestions, yearFilter, subjectFilter]);

  // keep index valid when filters change
  useEffect(() => {
    setQuestionIndex(0);
    setSelected(null);
    setIsCorrect(null);
    setAnalysis(null);
    setError(null);
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

  const resetAttemptState = () => {
    setSelected(null);
    setIsCorrect(null);
    setAnalysis(null);
    setError(null);
  };

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

  // When user clicks “Check & Generate Analysis”
  const handleCheckAndAnalyse = async () => {
    setError(null);
    setAnalysis(null);
    setIsCorrect(null);

    if (!question) {
      setError("Question not loaded yet.");
      return;
    }
    if (!selected) {
      setError("Please choose an option first.");
      return;
    }
    if (!correctKey) {
      setError("Correct option is not set for this question.");
      return;
    }

    setIsCorrect(selected === correctKey);

    try {
      setLoadingAnalysis(true);
      const res = await fetch(`/test-ai?questionId=${question.id}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const raw = await res.json();
      const normalized = normalizeQuestionAnalysisV1(raw);
      setAnalysis(normalized);
    } catch (err) {
      console.error("Failed to fetch AI analysis:", err);
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
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold">UPSC Practice</h1>
            <p className="text-sm text-slate-400 mt-1">
              Practice PYQs → check answer → see explanation.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCheckAndAnalyse}
              disabled={loadingAnalysis || loadingQuestion || !question}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {loadingAnalysis ? "Generating..." : "Check & Generate Analysis"}
            </button>

            <button
              onClick={handleLogout}
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
              type="button"
            >
              Logout
            </button>
          </div>
        </header>

        {/* Filters row */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-400">Year</span>
              <select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                className="bg-slate-950/60 border border-slate-700 rounded-md px-3 py-2 text-sm"
              >
                <option value="All">All</option>
                {years.map((y) => (
                  <option key={y} value={String(y)}>
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
                className="bg-slate-950/60 border border-slate-700 rounded-md px-3 py-2 text-sm"
              >
                <option value="All">All</option>
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-xs text-slate-400">
            Showing{" "}
            <span className="text-slate-200 font-semibold">{filteredQuestions.length}</span>{" "}
            of{" "}
            <span className="text-slate-200 font-semibold">{allQuestions.length}</span>{" "}
            questions
          </div>
        </section>

        {/* Navigation */}
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={handlePrev}
            disabled={loadingQuestion || questionIndex <= 0}
            className="rounded-md bg-slate-900 border border-slate-700 px-3 py-1 text-xs md:text-sm disabled:opacity-40"
          >
            ← Previous
          </button>

          <p className="text-xs text-slate-400">
            {filteredQuestions.length > 0
              ? `Question ${questionIndex + 1} of ${filteredQuestions.length}`
              : "No questions in this filter"}
          </p>

          <button
            onClick={handleNext}
            disabled={loadingQuestion || questionIndex >= filteredQuestions.length - 1}
            className="rounded-md bg-slate-900 border border-slate-700 px-3 py-1 text-xs md:text-sm disabled:opacity-40"
          >
            Next →
          </button>
        </div>

        {/* Question card */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          {loadingQuestion && (
            <p className="text-sm text-slate-400">Loading questions from Supabase…</p>
          )}

          {!loadingQuestion && question && (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-400 flex flex-wrap gap-2">
                {question.subject && <span>{question.subject}</span>}
                {question.year && <span>• {question.year}</span>}
                {question.question_number && <span>• Q{question.question_number}</span>}
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

        {/* AI analysis tabs */}
        {analysis && <AnalysisTabs analysis={analysis} />}
      </div>
    </main>
  );
}

/* ======================================================
   Analysis Tabs
   ====================================================== */

type AnalysisTabsProps = {
  analysis: QuestionAnalysisV1;
};

function AnalysisTabs({ analysis }: AnalysisTabsProps) {
  const [activeTab, setActiveTab] = useState<"solution" | "strategy">("solution");

  const tabBase = "px-4 py-2 text-sm rounded-md border transition-colors";
  const tabActive = "bg-emerald-500 text-slate-950 border-emerald-500";
  const tabInactive =
    "bg-slate-900 text-slate-300 border-slate-600 hover:bg-slate-800";

  const verdictColor = (v: StatementVerdict) => {
    if (v === "correct")
      return "bg-emerald-900 text-emerald-200 border-emerald-600";
    if (v === "incorrect") return "bg-rose-900 text-rose-200 border-rose-600";
    return "bg-amber-900 text-amber-100 border-amber-500";
  };

  const topicTitle = analysis?.topic_brief?.title ?? "Topic Brief";
  const topicBullets = analysis?.topic_brief?.bullets ?? [];

  return (
    <section className="space-y-4">
      <div className="flex gap-2 border-b border-slate-700 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("solution")}
          className={`${tabBase} ${activeTab === "solution" ? tabActive : tabInactive}`}
        >
          Solution &amp; Explanation
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("strategy")}
          className={`${tabBase} ${activeTab === "strategy" ? tabActive : tabInactive}`}
        >
          Exam Strategy
        </button>
      </div>

      {activeTab === "solution" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-600 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">
            <div className="font-semibold uppercase tracking-wide text-emerald-300 text-xs">
              Correct Answer
            </div>
            <div className="mt-1 text-lg font-bold">Option {analysis.correct_answer}</div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-2">
            <div className="text-sm font-semibold text-slate-200">
              Topic Brief — {topicTitle}
            </div>

            <ul className="mt-2 space-y-2 text-sm text-slate-200">
              {topicBullets.map((t, idx) => (
                <li
                  key={idx}
                  className="rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-sm text-slate-100"
                >
                  {t}
                </li>
              ))}

              {topicBullets.length === 0 && (
                <li className="text-sm text-slate-400">Topic brief not available.</li>
              )}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-200">
              Statement-wise Analysis
            </div>

            {analysis.statements.map((s, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-slate-700 bg-slate-950/40 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-slate-100">Statement {s.id}</p>
                  <span
                    className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${verdictColor(
                      s.verdict
                    )}`}
                  >
                    {s.verdict}
                  </span>
                </div>

                <ul className="mt-2 space-y-2">
                  {s.facts.map((f, j) => (
                    <li
                      key={j}
                      className="rounded-md border border-slate-700 bg-slate-900/40 p-3"
                    >
                      <div className="text-sm text-slate-100">{f.fact}</div>

                      {f.example && f.example.trim().length > 0 && (
                        <div className="mt-1 text-xs text-slate-300">
                          <span className="font-semibold text-slate-200">Example:</span>{" "}
                          {f.example}
                        </div>
                      )}

                      <div className="mt-2">
                        <SourceLine source={f.source} />
                      </div>
                    </li>
                  ))}

                  {s.facts.length === 0 && (
                    <li className="text-xs text-slate-400">
                      No facts returned for this statement.
                    </li>
                  )}
                </ul>
              </div>
            ))}

            {analysis.statements.length === 0 && (
              <div className="text-xs text-slate-400">
                No statement analysis returned.
              </div>
            )}
          </div>
        </div>
      ) : (
        <StrategyTabV1 analysis={analysis} />
      )}
    </section>
  );
}

function SourceLine({ source }: { source: SourceRef }) {
  const isLinkable =
    !!source.url &&
    (source.name === "PIB" ||
      source.name === "Govt website" ||
      source.name === "International org" ||
      source.name === "The Hindu" ||
      source.name === "Indian Express");

  return (
    <div className="text-[11px] text-slate-300">
      <span className="uppercase tracking-wide text-slate-400 font-semibold">Source:</span>{" "}
      <span className="text-slate-200 font-medium">{source.name}</span>{" "}
      <span className="text-slate-400">•</span>{" "}
      <span className="text-slate-300">{source.pointer}</span>
      {isLinkable && (
        <>
          {" "}
          <span className="text-slate-400">•</span>{" "}
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-300 hover:text-emerald-200 underline underline-offset-2"
          >
            Open
          </a>
        </>
      )}
    </div>
  );
}

function StrategyTabV1({ analysis }: { analysis: QuestionAnalysisV1 }) {
  const s = analysis.strategy;

  const badge =
    s.difficulty.level === "easy"
      ? "border-sky-500 bg-sky-900/40 text-sky-100"
      : s.difficulty.level === "moderate"
      ? "border-amber-500 bg-amber-900/30 text-amber-100"
      : "border-rose-500 bg-rose-900/30 text-rose-100";

  const verdictBadge =
    s.ai_verdict.recommendation === "attempt"
      ? "border-emerald-500 bg-emerald-900/40 text-emerald-100"
      : "border-rose-500 bg-rose-900/40 text-rose-100";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-slate-200">Difficulty</div>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${badge}`}
          >
            {s.difficulty.level}
          </span>
        </div>
        <ul className="mt-2 space-y-1 text-sm text-slate-200 list-disc list-inside">
          {s.difficulty.why.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
          {s.difficulty.why.length === 0 && (
            <li className="text-slate-400 list-none">No difficulty rationale returned.</li>
          )}
        </ul>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="font-semibold text-slate-200">Exam Strategy</div>
        <ul className="mt-2 space-y-1 text-sm text-slate-200 list-disc list-inside">
          {s.exam_strategy.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
          {s.exam_strategy.length === 0 && (
            <li className="text-slate-400 list-none">No strategy points returned.</li>
          )}
        </ul>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="font-semibold text-slate-200">Logical Deduction</div>
        <ul className="mt-2 space-y-1 text-sm text-slate-200 list-disc list-inside">
          {s.logical_deduction.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
          {s.logical_deduction.length === 0 && (
            <li className="text-slate-400 list-none">No deduction steps returned.</li>
          )}
        </ul>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex items-start gap-3">
        <div
          className={`mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${verdictBadge}`}
        >
          AI VERDICT: {s.ai_verdict.recommendation.toUpperCase()}
        </div>
        <div className="space-y-1">
          <div className="text-sm text-slate-200">{s.ai_verdict.rationale}</div>
          <div className="text-xs text-slate-400">
            Confidence:{" "}
            <span className="text-slate-200 font-semibold">{s.ai_verdict.confidence}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
