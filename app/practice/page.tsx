"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";
import type { QuestionAnalysisV1 } from "@/lib/aiAnalysis";

type QuestionRow = {
  id: number;
  year: number | null;
  subject: string | null;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option?: "A" | "B" | "C" | "D";
};

type TabKey = "solution" | "strategy";

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Badge({
  tone,
  children,
}: {
  tone: "green" | "red" | "gray" | "blue";
  children: React.ReactNode;
}) {
  const map = {
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    red: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    gray: "border-white/10 bg-white/5 text-white/70",
    blue: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
  } as const;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium",
        map[tone]
      )}
    >
      {children}
    </span>
  );
}

export default function PracticePage() {
  const router = useRouter();
  const supabase = supabaseClient;

  const [userId, setUserId] = useState<string | null>(null);

  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(true);

  const [yearFilter, setYearFilter] = useState<string>("All");
  const [subjectFilter, setSubjectFilter] = useState<string>("All");

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<"A" | "B" | "C" | "D" | null>(null);

  const [analysis, setAnalysis] = useState<QuestionAnalysisV1 | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("solution");

  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Auth gate
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) {
        router.replace("/login");
        return;
      }
      setUserId(data.user.id);
    })();
  }, [router, supabase]);

  // --- Load questions
  useEffect(() => {
    (async () => {
      try {
        setLoadingQuestions(true);
        setError(null);

        const { data, error } = await supabase
          .from("questions")
          .select(
            "id, year, subject, question_text, option_a, option_b, option_c, option_d, correct_option"
          )
          .order("id", { ascending: true })
          .limit(200);

        if (error) throw error;
        setQuestions((data ?? []) as QuestionRow[]);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load questions");
      } finally {
        setLoadingQuestions(false);
      }
    })();
  }, [supabase]);

  // --- Filters + derived list
  const years = useMemo(() => {
    const ys = new Set<string>();
    for (const q of questions) if (q.year) ys.add(String(q.year));
    return ["All", ...Array.from(ys).sort((a, b) => Number(b) - Number(a))];
  }, [questions]);

  const subjects = useMemo(() => {
    const ss = new Set<string>();
    for (const q of questions) if (q.subject) ss.add(q.subject);
    return ["All", ...Array.from(ss).sort()];
  }, [questions]);

  const filtered = useMemo(() => {
    return questions.filter((q) => {
      const yOk = yearFilter === "All" || String(q.year ?? "") === yearFilter;
      const sOk = subjectFilter === "All" || (q.subject ?? "") === subjectFilter;
      return yOk && sOk;
    });
  }, [questions, subjectFilter, yearFilter]);

  const current = filtered[index] ?? null;

  // Reset per-question state when changing question/filters
  useEffect(() => {
    setSelected(null);
    setAnalysis(null);
    setActiveTab("solution");
    setError(null);
  }, [index, yearFilter, subjectFilter]);

  // Keep index in bounds when filters change
  useEffect(() => {
    if (index >= filtered.length) setIndex(0);
  }, [filtered.length, index]);

  async function insertAttempt(payload: {
    user_id: string;
    question_id: number;
    selected_option: "A" | "B" | "C" | "D";
    is_correct: boolean;
  }) {
    // Don’t block UI if insert fails; just log
    const { error } = await supabase.from("question_attempts").insert(payload);
    if (error) console.warn("question_attempts insert error:", error.message);
  }

  async function handleGenerate() {
    if (!current) return;
    if (!selected) {
      setError("Select an option first.");
      return;
    }

    try {
      setChecking(true);
      setError(null);

      const res = await fetch(`/test-ai?questionId=${current.id}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `Failed: ${res.status}`);
      }

      const payload = (await res.json()) as QuestionAnalysisV1;
      setAnalysis(payload);

      // attempt logging (optional)
      if (userId) {
        const isCorrect = payload.correct_answer === selected;
        await insertAttempt({
          user_id: userId,
          question_id: current.id,
          selected_option: selected,
          is_correct: isCorrect,
        });
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate analysis");
    } finally {
      setChecking(false);
    }
  }

  function goPrev() {
    setIndex((x) => Math.max(0, x - 1));
  }
  function goNext() {
    setIndex((x) => Math.min(filtered.length - 1, x + 1));
  }

  const selectedLabel = selected ?? "—";

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#050A1A] via-[#040817] to-[#030613] text-white">
      <div className="mx-auto max-w-5xl px-4 py-10">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">UPSC Practice</h1>
            <p className="mt-1 text-sm text-white/60">
              Practice PYQs → check answer → see explanation
            </p>
          </div>

          {/* IMPORTANT: type="button" + not covered by overlay */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!current || !selected || checking}
            className={clsx(
              "rounded-xl px-5 py-2.5 text-sm font-semibold shadow",
              "border border-emerald-400/30 bg-emerald-500/20 text-emerald-100",
              "hover:bg-emerald-500/30 active:scale-[0.99]",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {checking ? "Generating..." : "Check & Generate Analysis"}
          </button>
        </div>

        {/* Filters + Prev/Next row (as you want) */}
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/60">YEAR</span>
                <select
                  value={yearFilter}
                  onChange={(e) => setYearFilter(e.target.value)}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-white/60">SUBJECT</span>
                <select
                  value={subjectFilter}
                  onChange={(e) => setSubjectFilter(e.target.value)}
                  className="min-w-[220px] rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
                >
                  {subjects.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ml-1 text-xs text-white/50">
                Showing{" "}
                <span className="font-semibold text-white/70">
                  {filtered.length}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-white/70">{questions.length}</span>{" "}
                questions
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goPrev}
                disabled={index <= 0}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
              >
                ← Previous
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={index >= filtered.length - 1}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        </div>

        {/* Main card */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          {loadingQuestions ? (
            <div className="text-white/70">Loading questions…</div>
          ) : !current ? (
            <div className="text-white/70">No questions match these filters.</div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-xs text-white/60">
                  {current.subject ?? "—"} • {current.year ?? "—"} • Q{current.id}
                </div>
                <div className="text-xs text-white/50">
                  Question {filtered.length ? index + 1 : 0} of {filtered.length}
                </div>
              </div>

              <div className="whitespace-pre-line rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/85">
                {current.question_text}
              </div>

              <div className="mt-4 space-y-2">
                {(
                  [
                    ["A", current.option_a],
                    ["B", current.option_b],
                    ["C", current.option_c],
                    ["D", current.option_d],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelected(key)}
                    className={clsx(
                      "w-full rounded-xl border px-4 py-3 text-left text-sm",
                      "transition",
                      selected === key
                        ? "border-emerald-400/50 bg-emerald-500/10"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    )}
                  >
                    <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-black/20 text-xs">
                      {key}
                    </span>
                    {label}
                  </button>
                ))}
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {error}
                </div>
              )}

              {/* Answer correctness line */}
              {analysis && (
                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  ✅ Correct answer is <b>{analysis.correct_answer}</b>. You selected{" "}
                  <b>{selectedLabel}</b>.
                </div>
              )}
            </>
          )}
        </div>

        {/* Analysis */}
        {analysis && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Solution & Guidance</div>
                <div className="text-sm text-white/60">
                  Clean UI view of the generated analysis (no raw JSON).
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("solution")}
                  className={clsx(
                    "rounded-xl border px-4 py-2 text-sm",
                    activeTab === "solution"
                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                      : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                  )}
                >
                  Solution & Explanation
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("strategy")}
                  className={clsx(
                    "rounded-xl border px-4 py-2 text-sm",
                    activeTab === "strategy"
                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                      : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                  )}
                >
                  Exam Strategy
                </button>
              </div>
            </div>

            {activeTab === "solution" ? (
              <div className="space-y-5">
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-2 text-xs text-white/60">CORRECT ANSWER</div>
                  <div className="text-2xl font-semibold">{analysis.correct_answer}</div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-2 text-xs text-white/60">TOPIC BRIEF</div>
                  <div className="text-lg font-semibold">
                    {analysis.topic_brief?.title ?? "—"}
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/80">
                    {(analysis.topic_brief?.bullets ?? []).map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 text-xs text-white/60">STATEMENT-WISE BREAKDOWN</div>

                  <div className="space-y-3">
                    {(analysis.statements ?? []).map((s, i) => {
                      const verdict = s.verdict ?? "unknown";
                      const tone =
                        verdict === "correct"
                          ? "green"
                          : verdict === "incorrect"
                          ? "red"
                          : "gray";

                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-white/10 bg-white/5 p-4"
                        >
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="font-semibold">Statement {s.id ?? i + 1}</div>
                            <Badge tone={tone}>
                              {verdict === "correct"
                                ? "CORRECT"
                                : verdict === "incorrect"
                                ? "INCORRECT"
                                : "UNKNOWN"}
                            </Badge>
                          </div>

                          <div className="space-y-2 text-sm text-white/80">
                            {(s.facts ?? []).map((f, j) => (
                              <div key={j} className="rounded-lg border border-white/10 bg-black/20 p-3">
                                <div>{f.fact}</div>
                                {f.example ? (
                                  <div className="mt-2 text-white/65">
                                    <span className="font-semibold text-white/70">
                                      Example:
                                    </span>{" "}
                                    {f.example}
                                  </div>
                                ) : null}
                                {f.source?.label ? (
                                  <div className="mt-2 text-white/60">
                                    <span className="font-semibold text-white/70">
                                      Source:
                                    </span>{" "}
                                    {f.source.label}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              // Exam Strategy tab
              <div className="space-y-4">
                {/* Difficulty + Why */}
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">EXAM STRATEGY</div>
                    <Badge tone="blue">
                      Difficulty:{" "}
                      {analysis.strategy?.difficulty?.level
                        ? capitalize(analysis.strategy.difficulty.level)
                        : "—"}
                    </Badge>
                  </div>

                  <div className="text-xs text-white/60">WHY THIS DIFFICULTY?</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/80">
                    {(analysis.strategy?.difficulty?.why ?? []).map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>

                {/* What to do */}
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-semibold">WHAT TO DO IN THE EXAM</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/80">
                    {(analysis.strategy?.exam_strategy ?? []).map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>

                {/* Logical deduction */}
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-semibold">LOGICAL DEDUCTION & ELIMINATION</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/80">
                    {(analysis.strategy?.logical_deduction ?? []).map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>

                {/* AI Verdict LAST (as per your requirement) */}
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-2 text-sm font-semibold">AI VERDICT</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="gray">
                      Recommendation:{" "}
                      {analysis.strategy?.ai_verdict?.recommendation
                        ? analysis.strategy.ai_verdict.recommendation.toUpperCase()
                        : "—"}
                    </Badge>

                    {/* Confidence intentionally hidden (per your ask) */}
                    {/* <Badge tone="gray">
                      Confidence: {analysis.strategy?.ai_verdict?.confidence ?? "—"}%
                    </Badge> */}
                  </div>

                  <div className="mt-3 text-sm text-white/80">
                    {analysis.strategy?.ai_verdict?.rationale ?? "—"}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function capitalize(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
