// lib/aiAnalysis.ts
// Types + normalizer for the analysis payload returned by /test-ai

export type StatementVerdict = "correct" | "incorrect" | "unknown";

export type SourceName =
  | "NCERT"
  | "Tamil Nadu Board"
  | "Standard book"
  | "PIB"
  | "Govt website"
  | "International org"
  | "The Hindu"
  | "Indian Express"
  | "Other";

export type SourceRef = {
  name: SourceName;
  pointer: string; // e.g. "NCERT • Class 12 • History • Ch 8 • Civilising the Native"
  url?: string; // optional; shown only for selected sources
};

export type Fact = {
  fact: string;
  example?: string;
  source: SourceRef;
};

export type StatementBlock = {
  id: number; // always numeric in UI
  verdict: StatementVerdict;
  facts: Fact[];
};

export type TopicBrief = {
  title: string;
  bullets: string[];
};

export type StrategyV1 = {
  difficulty: {
    level: "easy" | "moderate" | "hard";
    why: string[];
  };
  exam_strategy: string[];
  logical_deduction: string[];
  ai_verdict: {
    recommendation: "attempt" | "skip";
    rationale: string;
    confidence: number; // 0-100
  };
};

export type QuestionAnalysisV1 = {
  correct_answer: "A" | "B" | "C" | "D" | string;
  topic_brief: TopicBrief;
  statements: StatementBlock[];
  strategy: StrategyV1;
};

/** Lightweight helpers */
const asString = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

const asNumber = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const asArray = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? v : []);

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

const normalizeSourceName = (n: unknown): SourceName => {
  const s = String(n ?? "").trim();
  const allowed: SourceName[] = [
    "NCERT",
    "Tamil Nadu Board",
    "Standard book",
    "PIB",
    "Govt website",
    "International org",
    "The Hindu",
    "Indian Express",
    "Other",
  ];
  return (allowed as string[]).includes(s) ? (s as SourceName) : "Other";
};

const normalizePointer = (p: unknown): string => {
  const s = String(p ?? "").trim();
  if (!s) return "General reference";
  // remove ugly placeholders if model outputs them
  return s
    .replace(/\bClass\s*\?\?\b/gi, "")
    .replace(/\bSubject\s*\?\?\b/gi, "")
    .replace(/\bChapter\/Section\b/gi, "Chapter/Section")
    .replace(/\s{2,}/g, " ")
    .replace(/\s•\s•/g, " • ")
    .trim()
    .replace(/^[•\s]+/, "")
    .replace(/[•\s]+$/, "");
};

/**
 * Normalizes any unknown JSON into a safe QuestionAnalysisV1.
 * This prevents UI crashes when fields are missing / wrong type.
 */
export function normalizeQuestionAnalysisV1(raw: unknown): QuestionAnalysisV1 {
  const obj = (raw ?? {}) as any;

  // --- topic_brief: enforce object {title, bullets[]} always
  let topicTitle = "Topic Brief";
  let topicBullets: string[] = [];

  const tb = obj.topic_brief;

  if (tb && typeof tb === "object" && !Array.isArray(tb)) {
    topicTitle = asString(tb.title, "Topic Brief");
    topicBullets = asArray(tb.bullets).map((x) => asString(x)).filter(Boolean);
  } else if (Array.isArray(tb)) {
    topicBullets = tb.map((x) => asString(x)).filter(Boolean);
  } else if (typeof tb === "string") {
    topicBullets = [tb].filter(Boolean);
  }

  // --- statements: NEVER drop just because id is non-numeric.
  const statements: StatementBlock[] = asArray(obj.statements).map(
    (s: any, idx: number) => {
      const facts: Fact[] = asArray(s?.facts)
        .map((f: any) => {
          const sourceObj = f?.source ?? {};
          const source: SourceRef = {
            name: normalizeSourceName(sourceObj?.name),
            pointer: normalizePointer(sourceObj?.pointer),
            url: typeof sourceObj?.url === "string" ? sourceObj.url : undefined,
          };

          return {
            fact: asString(f?.fact, "").trim(),
            example:
              typeof f?.example === "string" && f.example.trim().length > 0
                ? f.example.trim()
                : undefined,
            source,
          };
        })
        .filter((x) => x.fact.length > 0);

      const verdictRaw = asString(s?.verdict, "unknown") as StatementVerdict;
      const verdict: StatementVerdict =
        verdictRaw === "correct" ||
        verdictRaw === "incorrect" ||
        verdictRaw === "unknown"
          ? verdictRaw
          : "unknown";

      // If model returns id like "I"/"II"/null → fallback to idx+1
      const idCandidate =
        typeof s?.id === "number" && Number.isFinite(s.id) ? s.id : NaN;
      const id = Number.isFinite(idCandidate) && idCandidate > 0 ? idCandidate : idx + 1;

      return {
        id,
        verdict,
        facts,
      };
    }
  );

  // --- strategy: safe object
  const st = obj.strategy ?? {};
  const diff = st.difficulty ?? {};

  const difficultyLevelRaw = asString(diff.level, "moderate");
  const difficultyLevel =
    difficultyLevelRaw === "easy" ||
    difficultyLevelRaw === "moderate" ||
    difficultyLevelRaw === "hard"
      ? difficultyLevelRaw
      : "moderate";

  const confidence = clamp(asNumber(st?.ai_verdict?.confidence, 60), 0, 100);

  const strategy: StrategyV1 = {
    difficulty: {
      level: difficultyLevel,
      why: asArray(diff.why).map((x) => asString(x)).filter(Boolean),
    },
    exam_strategy: asArray(st.exam_strategy).map((x) => asString(x)).filter(Boolean),
    logical_deduction: asArray(st.logical_deduction).map((x) => asString(x)).filter(Boolean),
    ai_verdict: {
      recommendation:
        asString(st?.ai_verdict?.recommendation, "attempt") === "skip"
          ? "skip"
          : "attempt",
      rationale: asString(st?.ai_verdict?.rationale, ""),
      confidence,
    },
  };

  return {
    correct_answer: asString(obj.correct_answer, ""),
    topic_brief: {
      title: topicTitle,
      bullets: topicBullets,
    },
    statements,
    strategy,
  };
}
