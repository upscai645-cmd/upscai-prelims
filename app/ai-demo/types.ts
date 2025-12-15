// app/ai-demo/types.ts

// 1️⃣ Question row shape coming from Supabase
export type QuestionRow = {
  id: number; // or string if your Supabase id is uuid
  year: number | null;
  subject: string | null;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: "A" | "B" | "C" | "D";
};

// 2️⃣ Analysis types for the AI layer (2-tab layout)

export type StatementVerdict = "correct" | "incorrect" | "partially correct";

export type StatementReference = {
  source: string;   // e.g. "Laxmikanth – Parliament → Speaker"
  summary: string;  // 1–2 line paraphrase
};

export type StatementAnalysis = {
  statement: string;          // full text: "I. ...."
  verdict: StatementVerdict;  // correct / incorrect / partially correct
  explanation: string;        // main conceptual explanation
  reference?: StatementReference;
};

export type QuestionStrategy = {
  question_type: "easy" | "moderate" | "hard";
  one_minute_approach: string;
  traps: string[];             // bullet list
  exam_cues: string[];         // bullet list
  should_attempt: "attempt" | "avoid";
  why_attempt_or_avoid: string;
};

export type QuestionAnalysis = {
  correct_answer: "A" | "B" | "C" | "D";
  statement_wise: StatementAnalysis[];
  final_tally: {
    correct_statements: string[];    // e.g. ["I", "III"]
    incorrect_statements: string[];  // e.g. ["II"]
    final_answer_reasoning: string;  // 2–3 lines
  };
  strategy: QuestionStrategy;
};
