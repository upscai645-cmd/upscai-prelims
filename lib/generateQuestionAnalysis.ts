// lib/generateQuestionAnalysis.ts
import OpenAI from "openai";
import type {
  QuestionAnalysisV1,
  SourceRef,
  SourceName,
  StatementVerdict,
} from "@/lib/aiAnalysis";
import { normalizeQuestionAnalysisV1 } from "@/lib/aiAnalysis";

export type GenerateInput = {
  questionText: string;
  options: { A?: string; B?: string; C?: string; D?: string };
  officialAnswer: "A" | "B" | "C" | "D";
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function safeParseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/* -------------------------------------------------------
   Source sanitization + smart mapping (MVP)
------------------------------------------------------- */

const ALLOWED_SOURCES: SourceName[] = [
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

function cleanPointer(pointer: string): string {
  return String(pointer || "")
    .replace(/\?\?/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s•\s•/g, " • ")
    .trim();
}

function inferSourceFromText(questionText: string, factText: string): SourceName {
  const t = `${questionText} ${factText}`.toLowerCase();

  // PIB
  if (t.includes("pib") || t.includes("press information bureau") || t.includes("press release")) {
    return "PIB";
  }

  // Govt website / official docs
  const govtHints = [
    "ministry",
    "department",
    "government of india",
    "gazette",
    "notification",
    "circular",
    "guidelines",
    "framework",
    "rules",
    "act",
    "bill",
    "ordinance",
    "commission",
    "finance commission",
    "report",
    "scheme",
    "yojana",
    "mission",
    "portal",
    "website",
    "press note",
  ];
  if (govtHints.some((k) => t.includes(k))) return "Govt website";

  // International org / treaty bodies
  const intlHints = [
    "unfccc",
    "paris agreement",
    "kyoto",
    "cop",
    "ipcc",
    "iea",
    "undp",
    "unep",
    "who",
    "world bank",
    "imf",
    "un",
    "unesco",
    "fao",
    "oecd",
    "wto",
    "iucn",
    "united nations",
  ];
  if (intlHints.some((k) => t.includes(k))) return "International org";

  // Newspapers (only if explicitly mentioned)
  if (t.includes("the hindu")) return "The Hindu";
  if (t.includes("indian express")) return "Indian Express";

  // Default (better than Other for UPSC prep)
  return "Standard book";
}

function sanitizeSource(
  src: any,
  questionText: string,
  factText: string
): SourceRef {
  const rawName = String(src?.name || "Other").trim();
  let name: SourceName = (ALLOWED_SOURCES.includes(rawName as SourceName)
    ? (rawName as SourceName)
    : "Other");

  let pointer = cleanPointer(String(src?.pointer || ""));
  const url =
    typeof src?.url === "string" && src.url.startsWith("http") ? src.url : undefined;

  // If name is Other OR pointer is too generic -> infer a better bucket
  const pointerTooGeneric =
    !pointer ||
    pointer.length < 8 ||
    pointer.toLowerCase().includes("general reference") ||
    pointer.toLowerCase().includes("chapter on") ||
    pointer.toLowerCase().includes("section on");

  if (name === "Other" || pointerTooGeneric) {
    name = inferSourceFromText(questionText, factText);
  }

  // Professional default pointers (no ??, no "verify")
  if (!pointer || pointerTooGeneric) {
    if (name === "NCERT") pointer = "NCERT • Textbook reference";
    else if (name === "Tamil Nadu Board") pointer = "Tamil Nadu Board • Textbook reference";
    else if (name === "PIB") pointer = "PIB • Release/Article";
    else if (name === "Govt website") pointer = "Govt website • Official page/document";
    else if (name === "International org") pointer = "International organisation • Official document/page";
    else if (name === "The Hindu") pointer = "The Hindu • Article";
    else if (name === "Indian Express") pointer = "Indian Express • Article";
    else if (name === "Standard book") pointer = "Standard book • Reference";
    else pointer = "General reference";
  }

  // URLs only for external sources
  const linkable =
    name === "PIB" ||
    name === "Govt website" ||
    name === "International org" ||
    name === "The Hindu" ||
    name === "Indian Express";

  return { name, pointer, url: linkable ? url : undefined };
}

/* -------------------------------------------------------
   Quality checks (avoid template garbage)
------------------------------------------------------- */

function looksGenericTopicBullets(bullets: string[]) {
  const joined = bullets.join(" | ").toLowerCase();
  const badPhrases = [
    "core concept",
    "key definition",
    "where upsc hides confusion",
    "what to recall vs what to deduce",
    "general reference",
  ];
  return badPhrases.some((p) => joined.includes(p));
}

function looksGenericStatementFacts(facts: { fact: string }[]) {
  const joined = facts.map((f) => f.fact.toLowerCase()).join(" | ");
  const bad = [
    "matches the key concept",
    "other options contradict",
    "standard framing",
    "general reference",
    "directly matches the fact asked",
  ];
  return bad.some((p) => joined.includes(p));
}

function analysisLooksWeak(a: QuestionAnalysisV1): boolean {
  const tb = a.topic_brief?.bullets ?? [];
  if (tb.length < 2) return true;
  if (looksGenericTopicBullets(tb)) return true;

  const st = a.statements ?? [];
  if (st.length === 0) return true;

  const hasGoodStatement = st.some((s) => {
    const facts = s.facts ?? [];
    if (facts.length < 2) return false;
    if (looksGenericStatementFacts(facts)) return false;
    return true;
  });
  if (!hasGoodStatement) return true;

  const strategy = a.strategy;
  if (!strategy) return true;
  if ((strategy.exam_strategy?.length ?? 0) < 2) return true;
  if ((strategy.logical_deduction?.length ?? 0) < 2) return true;
  if ((strategy.difficulty?.why?.length ?? 0) < 1) return true;
  if (!strategy.ai_verdict?.rationale || strategy.ai_verdict.rationale.trim().length < 10)
    return true;

  return false;
}

/* -------------------------------------------------------
   Prompt
------------------------------------------------------- */

function buildPrompt(input: GenerateInput) {
  const { questionText, options, officialAnswer } = input;

  return `
You are a UPSC Prelims (GS) expert.

NON-NEGOTIABLE:
- Official correct option is ${officialAnswer}.
- correct_answer MUST be "${officialAnswer}".
- Do NOT dispute the answer key.

STYLE RULES (STRICT):
- No generic filler lines.
- Topic Brief: 3–6 bullets, SPECIFIC to this question/topic.
- Statement-wise: Provide supporting/contradicting FACTS (not rephrases).
- Each statement should have 2–4 facts if possible.
- Sources: If you cannot give exact NCERT/TN location confidently, keep pointer generic but professional.
- Prefer PIB/Govt/International org for schemes, reports, numeric statistics, treaties.

OUTPUT: Return ONLY JSON (no markdown, no extra text) in this schema:

{
  "correct_answer": "A|B|C|D",
  "topic_brief": { "title": "string", "bullets": ["string"] },
  "statements": [
    {
      "id": 1,
      "verdict": "correct|incorrect|unknown",
      "facts": [
        {
          "fact": "string",
          "example": "string (optional)",
          "source": {
            "name": "NCERT|Tamil Nadu Board|Standard book|PIB|Govt website|International org|The Hindu|Indian Express|Other",
            "pointer": "string",
            "url": "string (optional)"
          }
        }
      ]
    }
  ],
  "strategy": {
    "difficulty": { "level": "easy|moderate|hard", "why": ["string"] },
    "exam_strategy": ["string"],
    "logical_deduction": ["string"],
    "ai_verdict": {
      "recommendation": "attempt|skip",
      "rationale": "string",
      "confidence": 0
    }
  }
}

Question:
${questionText}

Options:
A) ${options.A ?? ""}
B) ${options.B ?? ""}
C) ${options.C ?? ""}
D) ${options.D ?? ""}
`.trim();
}

/* -------------------------------------------------------
   Post-process: sanitize sources + enforce structure
------------------------------------------------------- */

function postProcess(a: QuestionAnalysisV1, input: GenerateInput): QuestionAnalysisV1 {
  a.correct_answer = input.officialAnswer;

  // Topic brief
  a.topic_brief = a.topic_brief ?? { title: "Topic Brief", bullets: [] };
  a.topic_brief.title = (a.topic_brief.title || "Topic Brief").trim();
  a.topic_brief.bullets = Array.isArray(a.topic_brief.bullets)
    ? a.topic_brief.bullets.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  // Statements
  a.statements = Array.isArray(a.statements) ? a.statements : [];
  if (a.statements.length === 0) {
    a.statements = [{ id: 1, verdict: "unknown" as StatementVerdict, facts: [] }];
  }

  a.statements = a.statements.map((s, idx) => {
    const id = Number.isFinite(Number(s?.id)) && Number(s.id) > 0 ? Number(s.id) : idx + 1;
    const verdictRaw = String(s?.verdict || "unknown").toLowerCase();
    const verdict: StatementVerdict =
      verdictRaw === "correct" || verdictRaw === "incorrect" || verdictRaw === "unknown"
        ? (verdictRaw as StatementVerdict)
        : "unknown";

    const factsRaw = Array.isArray(s?.facts) ? s.facts : [];
    const facts = factsRaw
      .map((f: any) => {
        const fact = String(f?.fact || "").trim();
        if (!fact) return null;

        const example = typeof f?.example === "string" ? f.example.trim() : undefined;
        const source = sanitizeSource(f?.source ?? {}, input.questionText, fact);

        return { fact, example: example && example.length > 0 ? example : undefined, source };
      })
      .filter(Boolean) as any[];

    return { id, verdict, facts };
  });

  // Strategy defaults
  a.strategy = a.strategy ?? {
    difficulty: { level: "moderate", why: [] },
    exam_strategy: [],
    logical_deduction: [],
    ai_verdict: { recommendation: "attempt", rationale: "", confidence: 60 },
  };

  const lvl = String(a.strategy.difficulty?.level || "moderate").toLowerCase();
  a.strategy.difficulty.level = (lvl === "easy" || lvl === "moderate" || lvl === "hard"
    ? lvl
    : "moderate") as any;

  a.strategy.difficulty.why = Array.isArray(a.strategy.difficulty?.why)
    ? a.strategy.difficulty.why.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  a.strategy.exam_strategy = Array.isArray(a.strategy.exam_strategy)
    ? a.strategy.exam_strategy.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  a.strategy.logical_deduction = Array.isArray(a.strategy.logical_deduction)
    ? a.strategy.logical_deduction.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  a.strategy.ai_verdict = a.strategy.ai_verdict ?? {
    recommendation: "attempt",
    rationale: "",
    confidence: 60,
  };
  a.strategy.ai_verdict.recommendation =
    String(a.strategy.ai_verdict.recommendation || "attempt") === "skip" ? "skip" : "attempt";
  a.strategy.ai_verdict.rationale = String(a.strategy.ai_verdict.rationale || "").trim();

  const conf = Number(a.strategy.ai_verdict.confidence);
  a.strategy.ai_verdict.confidence = Number.isFinite(conf) ? Math.max(0, Math.min(100, conf)) : 60;

  return a;
}

/* -------------------------------------------------------
   Main
------------------------------------------------------- */

export async function generateQuestionAnalysis(input: GenerateInput): Promise<QuestionAnalysisV1> {
  const prompt = buildPrompt(input);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: attempt === 1 ? 0.2 : 0.35,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });

    const content = res.choices?.[0]?.message?.content ?? "{}";
    const raw = safeParseJSON(content);

    let analysis = normalizeQuestionAnalysisV1(raw);
    analysis = postProcess(analysis, input);

    if (!analysisLooksWeak(analysis)) return analysis;
  }

  const fallback = normalizeQuestionAnalysisV1({
    correct_answer: input.officialAnswer,
    topic_brief: {
      title: "Topic Brief",
      bullets: [
        "This question hinges on a specific anchor fact; confirm it from a primary source.",
        "Attempt only if you can recall at least one anchor confidently under pressure.",
        "If no anchor exists quickly, skip to protect accuracy under negative marking.",
      ],
    },
    statements: [
      {
        id: 1,
        verdict: "unknown",
        facts: [
          {
            fact: "Confirm the key recall-based fact from an official document/textbook before relying on it in exam conditions.",
            source: { name: "Standard book", pointer: "Standard book • Reference" },
          },
        ],
      },
    ],
    strategy: {
      difficulty: { level: "moderate", why: ["Recall-heavy; depends on having read the source."] },
      exam_strategy: [
        "Look for one high-confidence anchor fact; if absent, skip fast.",
        "Don’t burn time validating multiple statements via guesswork.",
      ],
      logical_deduction: [
        "Prefer stable anchors (definitions, core NCERT concepts) over fuzzy recall.",
        "If >2 statements need blind recall, treat as a skip candidate.",
      ],
      ai_verdict: {
        recommendation: "skip",
        rationale:
          "Attempt only if you have a high-confidence anchor fact; otherwise skip to protect score under negative marking.",
        confidence: 55,
      },
    },
  });

  return postProcess(fallback, input);
}
