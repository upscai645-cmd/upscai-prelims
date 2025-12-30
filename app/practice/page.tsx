// app/practice/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";
import type { QuestionAnalysisV1, StatementVerdict, SourceRef } from "@/lib/aiAnalysis";
import { normalizeQuestionAnalysisV1 } from "@/lib/aiAnalysis";

type AnalysisTabsProps = {
  analysis: QuestionAnalysisV1;
  analysisUpdatedAt?: string | null;
  difficulty?: string; //
};

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
  difficulty: string | null;
};

type FeedbackState = {
  open: boolean;
  rating: number | null; // 1-5
  comment: string;
  submitting: boolean;
  submitted: boolean;
  error: string | null;
  context: "analysis" | "error";
};

// quota (free plan gating)
type QuotaState = {
  isPro: boolean;
  lifetimeFreeRemaining: number;
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

  // IMPORTANT: abort + request sequencing should ONLY be used for analysis
  const analysisAbortRef = useRef<AbortController | null>(null);
  const analysisReqIdRef = useRef(0);

  // quota
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);

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

  // Payment Gateway
  const [payOpen, setPayOpen] = useState(false);
  const [payLoading, setPayLoading] = useState(false);

  // ---- cleanup: abort any in-flight analysis on unmount ----
  useEffect(() => {
    return () => {
      analysisAbortRef.current?.abort();
      analysisAbortRef.current = null;
    };
  }, []);

  const loadRazorpay = () =>
    new Promise<boolean>((resolve) => {
      if (typeof window === "undefined") return resolve(false);
      if ((window as any).Razorpay) return resolve(true);

      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });

  const fetchQuota = async (force = false) => {
    const KEY = "quota_cache_v1";
    const TTL = 30 * 60 * 1000; // 30 minutes

    setQuotaLoading(true);
    try {
      if (!force) {
        try {
          const raw = localStorage.getItem(KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.ts && parsed?.data && Date.now() - parsed.ts < TTL) {
              setQuota(parsed.data as QuotaState);
              return;
            }
          }
        } catch {
          // ignore cache parse errors
        }
      }

      const { data: s, error: sErr } = await supabaseClient.auth.getSession();
      if (sErr) throw sErr;

      const token = s.session?.access_token;
      if (!token) {
        setQuota(null);
        return;
      }

      const res = await fetch("/api/quota", {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        console.warn("Quota API failed:", body);
        setQuota(null);
        return;
      }

      setQuota(body as QuotaState);

      try {
        localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), data: body }));
      } catch {
        // ignore storage errors
      }
    } catch (e) {
      console.warn("Failed to load quota:", e);
      setQuota(null);
    } finally {
      setQuotaLoading(false);
    }
  };

  const startPayment = async () => {
    try {
      setPayLoading(true);

      const ok = await loadRazorpay();
      if (!ok) throw new Error("Razorpay SDK failed to load.");

      const { data: s } = await supabaseClient.auth.getSession();
      const token = s.session?.access_token;
      if (!token) throw new Error("Session expired. Please login again.");

      const res = await fetch("/api/payments/razorpay/order", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to create order.");

      const { orderId, amount, currency, keyId } = data;

      const rzp = new (window as any).Razorpay({
        key: keyId,
        amount,
        currency,
        name: "UPSC PYQ",
        description: "Lifetime access",
        // callback_url: "/api/payments/razorpay/verify",
        order_id: orderId,
        handler: async (resp: any) => {
          console.log("Razorpay handler fired:", resp);
          console.log("Calling /api/payments/razorpay/verify");

          try {
            // ✅ reuse token that you already created BEFORE rzp.open()
            // (the token variable must be in scope of startPayment)
            const vr = await fetch("/api/payments/razorpay/verify", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                orderId: resp.razorpay_order_id,
                paymentId: resp.razorpay_payment_id,
                signature: resp.razorpay_signature,
              }),
            });

            const vBody = await vr.json().catch(() => null);
            if (!vr.ok) throw new Error(vBody?.error || "Verify failed");

            try { localStorage.removeItem("quota_cache_v1"); } catch {}
            setPayOpen(false);

            setQuota((q) => ({
              isPro: true,
              lifetimeFreeRemaining: q?.lifetimeFreeRemaining ?? 0,
            }));

            await fetchQuota(true);
            router.refresh();
          } catch (e: any) {
            console.error("verify route failed", e);
            setError(e?.message || "Payment verify failed.");
          }
        },

        modal: { ondismiss: () => setPayOpen(false) },
      });

      rzp.open();
    } catch (e: any) {
      setError(e?.message ?? "Payment failed to start.");
    } finally {
      setPayLoading(false);
    }
  };

  /* ---------- recordAttempt (upsert) ---------- */
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

      const { error: insertErr } = await supabaseClient
        .from("question_attempts")
        .upsert(
          {
            user_id: user.id,
            question_id: params.questionId,
            selected_option: params.selectedOption,
            is_correct: params.isCorrect,
          },
          { onConflict: "user_id,question_id" }
        );

      if (insertErr) throw insertErr;
    } catch (e) {
      console.error("Failed to record attempt:", e);
    }
  };

  /* ---------- recordAnalysis (upsert) ---------- */
  const recordAnalysis = async (params: { questionId: number; analysis: any }) => {
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

        const userId = session.user.id;

        const { data: profile, error: pErr } = await supabaseClient
          .from("profiles")
          .select("onboarded")
          .eq("id", userId)
          .maybeSingle();

        if (pErr) throw pErr;

        if (!profile || profile.onboarded === false) {
          router.replace("/onboarding?redirect=/practice");
          return;
        }

        if (alive) setAuthChecked(true);
      } catch {
        router.replace("/login?redirect=/practice");
      }
    };

    check();

    const { data: sub } = supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        router.replace("/login?redirect=/practice");
        return;
      }

      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("onboarded")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!profile || profile.onboarded === false) {
        router.replace("/onboarding?redirect=/practice");
      }
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

  /* ======================================================
     LOAD QUOTA (ONLY AFTER AUTH CHECK)
     ====================================================== */
  useEffect(() => {
    if (!authChecked) return;
    fetchQuota();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const resetAttemptState = () => {
    setSelected(null);
    setIsCorrect(null);
    setAnalysis(null);
    setError(null);
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

  useEffect(() => {
    setQuestionIndex(0);
    resetAttemptState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearFilter, subjectFilter]);

  const question = filteredQuestions[questionIndex] ?? null;

  useEffect(() => {
    if (!authChecked || !question) return;

    // Abort any in-flight analysis when switching question
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setLoadingAnalysis(false);

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
            .select("analysis,updated_at")
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

      if (feedback.context === "analysis") {
        if (!feedback.rating) throw new Error("Please choose a rating (1–5).");
        if (feedback.rating < 5 && feedback.comment.trim().length < 10) {
          throw new Error("Please add a short note (min 10 chars) for ratings < 5.");
        }
      } else {
        if (feedback.comment.trim().length < 10) {
          throw new Error("Please describe the issue (min 10 chars).");
        }
      }

      const payload = {
        user_id: user.id,
        question_id: question.id,
        rating: feedback.rating,
        comment: feedback.comment.trim() || null,
        context: feedback.context,
      };

      const { data, error } = await supabaseClient
        .from("ai_feedback")
        .insert(payload)
        .select("id")
        .single();

      console.log("AI_FEEDBACK payload:", payload);
      console.log("AI_FEEDBACK result:", { data, error });

      if (error) {
        // surface the *real* supabase error
        throw new Error(error.message);
      }

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

    // Only analysis clicks should increment this
    const reqId = ++analysisReqIdRef.current;
    const isNewQuestionForUser = !analysis; // analysis loaded from DB means user already has this question unlocked

    if (!quotaLoading && quota && !quota.isPro && quota.lifetimeFreeRemaining <= 0 && isNewQuestionForUser) {
      setError("Free limit reached. Upgrade to continue.");
      setPayOpen(true);
      return;
    }
    
    setLoadingAnalysis(true);

    void recordAttempt({
      questionId: question.id,
      selectedOption: selected,
      isCorrect: correct,
    }).catch((e) => console.error("recordAttempt failed:", e));

    setIsCorrect(correct);

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

    try {
      const { data } = await supabaseClient.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setError("Session expired. Please login again.");
        router.replace("/login?redirect=/practice");
        return;
      }

      // Cancel any previous analysis request
      analysisAbortRef.current?.abort();
      const controller = new AbortController();
      analysisAbortRef.current = controller;

      const refresh = 1;
      const url = `/api/analysis?questionId=${question.id}&refresh=${refresh}`;

      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 402 || res.status === 429) {
        const msg = (await res.json().catch(() => null))?.error;
        setError(msg || "AI analysis limit reached for today.");
        setPayOpen(true);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg =
          body?.message || body?.error || body?.details || `Server returned ${res.status}`;

        if (msg === "LIMIT_REACHED") {
          setError("AI analysis limit reached.");
          setPayOpen(true);
          return;
        }

        throw new Error(msg);
      }

      const payload = await res.json();
      console.log("analysis payload:", payload);

      const normalized = normalizeQuestionAnalysisV1(payload.analysis ?? payload);
      setAnalysis(normalized);
      setAnalysisUpdatedAt(new Date().toISOString());

      void recordAnalysis({ questionId: question.id, analysis: normalized });

      // If you later re-enable quota deduction logic, do it here.
      // if (payload?.quotaSpent) void fetchQuota(true);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("Failed to fetch AI analysis:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch AI analysis. Please try again."
        );
      }
    } finally {
      // Always stop the spinner for the latest request only
      if (reqId === analysisReqIdRef.current) {
        setLoadingAnalysis(false);
      }
    }
  }; // ✅ IMPORTANT: semicolon here

  // While auth is being checked, keep it quiet (prevents flash)
  if (!authChecked) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
        <div className="max-w-4xl mx-auto text-sm text-slate-400">Checking session…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold">UPSC PYQ – Practice</h1>
            <p className="text-sm text-slate-400 mt-1">Solve → Check → Generate AI explanation.</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCheckAndAnalyse}
              disabled={loadingAnalysis || loadingQuestion || !question || !selected}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {loadingAnalysis ? "Generating..." : "Check & Generate Analysis"}
            </button>

            {quotaLoading ? (
              <div className="text-xs text-slate-300">Quota…</div>
            ) : quota ? (
              quota.isPro ? (
                <div className="text-xs font-semibold rounded-md border border-emerald-600 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                  PRO
                </div>
              ) : (
                <div className="text-xs text-slate-300">
                  Remaining free:{" "}
                  <span className="font-semibold text-slate-100">
                    {quota.lifetimeFreeRemaining}
                  </span>
                </div>
              )
            ) : null}

            {quota && !quota.isPro && quota.lifetimeFreeRemaining <= 0 && (
              <button
                type="button"
                onClick={() => setPayOpen(true)}
                className="rounded-md bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
              >
                Pay now
              </button>
            )}

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
            <span className="text-slate-200 font-semibold">{filteredQuestions.length}</span> of{" "}
            <span className="text-slate-200 font-semibold">{allQuestions.length}</span> questions
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
            <AnalysisTabs analysis={analysis} analysisUpdatedAt={analysisUpdatedAt} difficulty={question?.difficulty ?? undefined} />
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
                <div className="text-sm text-emerald-300 font-medium">✅ Thanks! Feedback saved.</div>
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

        {/* Pay modal */}
        {payOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-slate-100">Upgrade</div>
                  <div className="text-xs text-slate-400 mt-1">
                    Lifetime access ₹399 — unlimited analysis.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPayOpen(false)}
                  className="text-slate-400 hover:text-slate-100"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPayOpen(false)}
                  className="rounded-md bg-slate-900 border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                  disabled={payLoading}
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={startPayment}
                  className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                  disabled={payLoading}
                >
                  {payLoading ? "Opening..." : "Pay ₹399"}
                </button>
              </div>
            </div>
          </div>
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
                  <div className="text-xs uppercase tracking-wide text-slate-400">Rating</div>
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
   Analysis Tabs
   ====================================================== */

function AnalysisTabs({ analysis, analysisUpdatedAt, difficulty }: AnalysisTabsProps) {
  const [activeTab, setActiveTab] = useState<"solution" | "strategy">("solution");

  const tabBase = "px-4 py-2 text-sm rounded-md border transition-colors";
  const tabActive = "bg-emerald-500 text-slate-950 border-emerald-500";
  const tabInactive = "bg-slate-900 text-slate-300 border-slate-600 hover:bg-slate-800";

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
          <div className="rounded-xl border border-emerald-600 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">
            <div className="font-semibold uppercase tracking-wide text-emerald-300 text-xs">
              Correct Answer
            </div>
            <div className="mt-1 text-lg font-bold">Option {analysis.correct_answer}</div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-2">
            <div className="text-sm font-semibold text-slate-200">Topic Brief — {topicTitle}</div>

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
                <li className="text-sm text-slate-400">Topic brief not available for this question.</li>
              )}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-200">Statement-wise Analysis</div>

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
                          <span className="font-semibold text-slate-200">Example:</span> {f.example}
                        </div>
                      )}

                      <div className="mt-2">
                        <SourceLine source={f.source} />
                      </div>
                    </li>
                  ))}

                  {s.facts.length === 0 && (
                    <li className="text-xs text-slate-400">No facts returned for this statement.</li>
                  )}
                </ul>
              </div>
            ))}

            {analysis.statements.length === 0 && (
              <div className="text-xs text-slate-400">No statement analysis returned for this question.</div>
            )}
          </div>
        </div>
      ) : (
        <StrategyTabV1 analysis={analysis} difficulty={difficulty} />
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

 

function StrategyTabV1({ analysis, difficulty,}: { analysis: QuestionAnalysisV1, difficulty?: string | null; }) {
  const s = analysis.strategy;
  const dbDifficulty = (difficulty ?? "Hard").toLowerCase();
  const badge =
    dbDifficulty === "easy"
      ? "border-sky-500 bg-sky-900/40 text-sky-100"
      : dbDifficulty === "medium"
      ? "border-amber-500 bg-amber-900/30 text-amber-100"
      : "border-rose-500 bg-rose-900/30 text-rose-100";

  const difficultyLabel =
    dbDifficulty === "easy" ? "Easy" : dbDifficulty === "medium" ? "Medium" : "Hard";

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
            {difficultyLabel}
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
        </div>
      </div>
    </div>
  );
}
