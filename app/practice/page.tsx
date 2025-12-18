// app/practice/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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

type FeedbackState = {
  open: boolean;
  rating: number | null; // 1-5
  comment: string;
  submitting: boolean;
  submitted: boolean;
  error: string | null;
  // context helps you debug if user reports an issue
  context: "analysis" | "error";
};

export default function PracticePage() {
  const router = useRouter();

  // auth
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
  const [analysisUpdatedAt, setAnalysisUpdatedAt] = useState<string | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  // feedback
  const [feedback, setFeedback] = useState<FeedbackState>({
    open: false,
    rating: null,
    comment: "",
    submitting: false,
    submitted: false,
    error: null,
    context: "analysis",
  });

  // 

  /* 👇 INSERT recordAttempt HERE */
const recordAttempt = async (params: {
    questionId: number;
    selectedOption: string;
    isCorrect: boolean;
  }) => {
    try {
      const { data: u, error: userErr } = await supabaseClient.auth.getUser();
      if (userErr) throw userErr;
      const user = u.user;
      if (!user) throw new Error("Not logged in.");

      const { error: insertErr } = await supabaseClient.from("question_attempts").upsert({
        user_id: user.id,
        question_id: params.questionId,
        selected_option: params.selectedOption,
        is_correct: params.isCorrect,
              
        // created_at should be DEFAULT now() in DB; no need to send it
      },
      { onConflict: "user_id,question_id"
      });

      if (insertErr) throw insertErr;
    } catch (e) {
      // Don’t block analysis if logging fails; but do log for debugging
      console.error("Failed to record attempt:", e);
    }
  };
  

  /* ======================================================
     AUTH GUARD (MUST RUN FIRST)
     ====================================================== */
  useEffect(() => {
    let alive = true;

    const check = async () => {
      try {
        const { data } = await supabaseClient.auth.getSession();
        const session = data.session;

        if (!session) {
          router.replace("/login?redirect=/practice");
          return;
        }

        if (alive) setAuthChecked(true);
      } catch {
        router.replace("/login?redirect=/practice");
      }
    };

    check();

    const { data: sub } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login?redirect=/practice");
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, [router]);

  /* ======================================================
     LOAD QUESTIONS (ONLY AFTER AUTH CHECK)
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
      const yearOk =
        yearFilter === "All" ? true : String(q.year ?? "") === yearFilter;
      const subjectOk =
        subjectFilter === "All"
          ? true
          : (q.subject ?? "").trim() === subjectFilter;
      return yearOk && subjectOk;
    });
  }, [allQuestions, yearFilter, subjectFilter]);

  // keep index valid when filters change
  useEffect(() => {
    setQuestionIndex(0);
    resetAttemptState();
  }, [yearFilter, subjectFilter]);

  const question = filteredQuestions[questionIndex] ?? null;

  useEffect(() => {
  if (!authChecked || !question) return;

  const loadLast = async () => {
    try {
      const { data: u } = await supabaseClient.auth.getUser();
      const user = u.user;
      if (!user) return;

      const [{ data: a }, { data: qa }] = await Promise.all([
        supabaseClient
          .from("question_attempts")
          .select("selected_option,is_correct")
          .eq("user_id", user.id)
          .eq("question_id", question.id)
          .maybeSingle(),

        supabaseClient
          .from("question_analysis")
          .select("analysis")
          .eq("user_id", user.id)
          .eq("question_id", question.id)
          .maybeSingle(),
      ]);

      setSelected(a?.selected_option ?? null);
      setIsCorrect(a?.is_correct ?? null);
      setAnalysis(qa?.analysis ? normalizeQuestionAnalysisV1(qa.analysis) : null);
      setAnalysisUpdatedAt(qa?.updated_at ?? null);
    } catch (e) {
      console.error("Failed to load last attempt/analysis:", e);
    }
  };

  loadLast();
}, [authChecked, question?.id]);

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
    // reset feedback every time user moves to a new question
    setFeedback({
      open: false,
      rating: null,
      comment: "",
      submitting: false,
      submitted: false,
      error: null,
      context: "analysis",
    });
  };

      
    // Record Analysis
    
  const recordAnalysis = async (params: {
  questionId: number;
  analysis: any; // jsonb
}) => {
  try {
    const { data: u, error: userErr } = await supabaseClient.auth.getUser();
    if (userErr) throw userErr;
    const user = u.user;
    if (!user) throw new Error("Not logged in.");

    const { error: upsertErr } = await supabaseClient.from("question_analysis").upsert(
      {
        user_id: user.id,
        question_id: params.questionId,
        analysis: params.analysis,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,question_id" }
    );

    if (upsertErr) throw upsertErr;
  } catch (e) {
    console.error("Failed to record analysis:", e);
  }
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
    router.replace("/login?redirect=/practice");
  };

  const openFeedback = (context: "analysis" | "error") => {
    setFeedback((f) => ({
      ...f,
      open: true,
      context,
      // keep existing rating/comment if user reopens
      error: null,
    }));
  };

  const closeFeedback = () => {
    setFeedback((f) => ({ ...f, open: false, error: null }));
  };

  const submitFeedback = async () => {
    setFeedback((f) => ({ ...f, submitting: true, error: null }));

    try {
      if (!question) throw new Error("No question loaded.");
      const { data: u } = await supabaseClient.auth.getUser();
      const user = u.user;
      if (!user) throw new Error("Not logged in.");

      // rules:
      // - rating is optional for "error" context (user may just report issue)
      // - if rating < 5, comment required
      if (feedback.context === "analysis") {
        if (!feedback.rating) throw new Error("Please choose a rating (1–5).");
        if (feedback.rating < 5 && feedback.comment.trim().length < 10) {
          throw new Error("Please add a short note (min 10 chars) for ratings < 5.");
        }
      } else {
        // error report
        if (feedback.comment.trim().length < 10) {
          throw new Error("Please describe the issue (min 10 chars).");
        }
      }

      // ✅ Insert into Supabase
      const payload = {
        user_id: user.id,
        question_id: question.id,
        rating: feedback.rating,
        comment: feedback.comment.trim() || null,
        context: feedback.context, // "analysis" | "error"
      };

      const { error } = await supabaseClient.from("ai_feedback").insert(payload);
      if (error) throw error;

      setFeedback((f) => ({
        ...f,
        submitting: false,
        submitted: true,
        error: null,
      }));
    } catch (e: any) {
      setFeedback((f) => ({
        ...f,
        submitting: false,
        error: e?.message ?? "Failed to submit feedback.",
      }));
    }
  };

  // When user clicks “Check & Generate Analysis”
  const handleCheckAndAnalyse = async () => {
    setError(null);
    setAnalysis(null);
    setIsCorrect(null);

    if (!question) return;
    if (!selected) {
      setError("Please choose an option first.");
      return;
    }
    if (!correctKey) {
      setError("Correct option is not set for this question.");
      return;
    }

    const correct = selected === correctKey;

    await recordAttempt({
      questionId: question.id,
      selectedOption: selected,
      isCorrect: correct,
    });

    setIsCorrect(correct);

    // reset feedback for this run
    setFeedback((f) => ({
      ...f,
      open: false,
      rating: null,
      comment: "",
      submitting: false,
      submitted: false,
      error: null,
      context: "analysis",
    }));

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
      setAnalysisUpdatedAt(new Date().toISOString());
      await recordAnalysis({
      questionId: question.id,
      analysis: normalized,
    });

      // ✅ After successful analysis, auto-open feedback lightly? (NO)
      // Keep it optional; user can click button.
    } catch (err) {
      console.error("Failed to fetch AI analysis:", err);
      setError("Failed to fetch AI analysis. Please try again.");
      // ✅ allow user to report issue even if analysis fails
      openFeedback("error");
    } finally {
      setLoadingAnalysis(false);
    }
  };

  // While auth is being checked, keep it quiet (prevents flash)
  if (!authChecked) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
        <div className="max-w-4xl mx-auto text-sm text-slate-400">
          Checking session…
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold">UPSC PYQ – Practice</h1>
            <p className="text-sm text-slate-400 mt-1">
              Solve → Check → Generate AI explanation.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCheckAndAnalyse}
              disabled={loadingAnalysis || loadingQuestion || !question || !selected}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {loadingAnalysis ? "Generating..." : "Check & Generate Analysis"}
            </button>

            <Link
              href="/profile"
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              My Profile
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
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Subject
              </span>
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

        {/* Navigation (above question, below filters) */}
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

              {/* Always allow "Report issue" */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => openFeedback("error")}
                  className="text-xs text-slate-300 underline underline-offset-2 hover:text-slate-100"
                >
                  Report an issue with this question / analysis
                </button>
              </div>
            </>
          )}

          {!loadingQuestion && !question && !error && (
            <p className="text-sm text-rose-400">No question found for this filter.</p>
          )}
        </section>

        {/* AI analysis */}
        {analysis && (
          <section className="space-y-3">
            <AnalysisTabs
              analysis={analysis}
              analysisUpdatedAt={analysisUpdatedAt}
            />

            {/* ✅ Feedback CTA after analysis */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  Was this AI explanation helpful?
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Rate 1–5. If less than 5, tell us what to improve.
                </div>
              </div>

              {feedback.submitted ? (
                <div className="text-sm text-emerald-300 font-medium">
                  ✅ Thanks! Feedback saved.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openFeedback("analysis")}
                  className="rounded-md bg-slate-900 border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  Give feedback
                </button>
              )}
            </div>
          </section>
        )}

        {/* Feedback modal */}
        {feedback.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-slate-100">
                    {feedback.context === "analysis" ? "Rate this explanation" : "Report an issue"}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {feedback.context === "analysis"
                      ? "1–5 rating. If you give < 5, add a short note."
                      : "Describe what went wrong (analysis error / missing content / wrong answer / UI bug)."}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeFeedback}
                  className="text-slate-400 hover:text-slate-100"
                >
                  ✕
                </button>
              </div>

              {feedback.context === "analysis" && (
                <div className="mt-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">
                    Rating
                  </div>
                  <div className="mt-2 flex gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setFeedback((f) => ({ ...f, rating: n }))}
                        className={`h-9 w-9 rounded-md border text-sm font-semibold ${
                          feedback.rating === n
                            ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
                            : "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4">
                <div className="text-xs uppercase tracking-wide text-slate-400">
                  {feedback.context === "analysis" ? "What can we improve?" : "Issue details"}
                </div>
                <textarea
                  value={feedback.comment}
                  onChange={(e) => setFeedback((f) => ({ ...f, comment: e.target.value }))}
                  rows={4}
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900/40 px-3 py-2 text-sm text-slate-100"
                  placeholder={
                    feedback.context === "analysis"
                      ? "E.g., too generic, missing source pointer, wrong focus, etc."
                      : "E.g., analysis failed to generate, blank tab, wrong answer, etc."
                  }
                />
              </div>

              {feedback.error && (
                <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  {feedback.error}
                </div>
              )}

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeFeedback}
                  className="rounded-md bg-slate-900 border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                  disabled={feedback.submitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitFeedback}
                  className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                  disabled={feedback.submitting}
                >
                  {feedback.submitting ? "Saving…" : "Submit"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/* ======================================================
   Analysis Tabs (same UI you already had)
   ====================================================== */

type AnalysisTabsProps = {
  analysis: QuestionAnalysisV1;
  analysisUpdatedAt?: string | null;
};

function AnalysisTabs({
  analysis,
  analysisUpdatedAt,
}: {
  analysis: QuestionAnalysisV1;
  analysisUpdatedAt: string | null;
}) {
  const [activeTab, setActiveTab] = useState<"solution" | "strategy">("solution");

  const tabBase = "px-4 py-2 text-sm rounded-md border transition-colors";
  const tabActive = "bg-emerald-500 text-slate-950 border-emerald-500";
  const tabInactive =
    "bg-slate-900 text-slate-300 border-slate-600 hover:bg-slate-800";

  const verdictTag = (v: StatementVerdict) => {
    if (v === "correct") return "border-emerald-600 bg-emerald-500/10 text-emerald-200";
    if (v === "incorrect") return "border-rose-600 bg-rose-500/10 text-rose-200";
    return "border-amber-500 bg-amber-500/10 text-amber-100";
  };

  const topicTitle = analysis?.topic_brief?.title ?? "Topic Brief";
  const topicBullets = analysis?.topic_brief?.bullets ?? [];

  return (
    <section className="space-y-4">
      {analysisUpdatedAt && (
      <div className="text-xs text-slate-400">
    Last generated: {new Date(analysisUpdatedAt).toLocaleString()}
  </div>
)}
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
          {/* Correct answer */}
          <div className="rounded-xl border border-emerald-600 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">
            <div className="font-semibold uppercase tracking-wide text-emerald-300 text-xs">
              Correct Answer
            </div>
            <div className="mt-1 text-lg font-bold">Option {analysis.correct_answer}</div>
          </div>

          {/* Topic brief */}
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
                <li className="text-sm text-slate-400">
                  Topic brief not available for this question.
                </li>
              )}
            </ul>
          </div>

          {/* Statements */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-200">
              Statement-wise Analysis
            </div>

            {analysis.statements.map((s) => (
              <div
                key={s.id}
                className="rounded-lg border border-slate-700 bg-slate-950/40 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-slate-100">Statement {s.id}</p>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${verdictTag(
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
                No statement analysis returned for this question.
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
      <span className="uppercase tracking-wide text-slate-400 font-semibold">
        Source:
      </span>{" "}
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
      {/* 1) Difficulty */}
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

      {/* 2) Exam Strategy */}
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

      {/* 3) Logical Deduction */}
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

      {/* 4) AI Verdict */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex items-start gap-3">
        <div
          className={`mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${verdictBadge}`}
        >
          AI VERDICT: {s.ai_verdict.recommendation.toUpperCase()}
        </div>
        <div className="space-y-1">
          <div className="text-sm text-slate-200">{s.ai_verdict.rationale}</div>
        </div>
      </div>
    </div>
  );
}
