// app/test-ai/route.ts
import { NextResponse } from "next/server";
import { supabaseServerClient } from "@/lib/supabaseServer";
import { generateQuestionAnalysis } from "@/lib/generateQuestionAnalysis";
import type { QuestionAnalysisV1 } from "@/lib/aiAnalysis";
import { normalizeQuestionAnalysisV1 } from "@/lib/aiAnalysis";

export const runtime = "nodejs";

// 🔍 DEBUG: see whether the server can read the env var
console.log(
  "DEBUG OPENAI_API_KEY (first 10 chars):",
  process.env.OPENAI_API_KEY?.slice(0, 10)
);

function getStubAnalysis(questionId: number): QuestionAnalysisV1 {
  // Just a generic stub; UI-safe
  const guess: "A" | "B" | "C" | "D" = questionId % 4 === 0 ? "D" : "C";

  return normalizeQuestionAnalysisV1({
    correct_answer: guess,
    topic_brief: { title: "Topic Brief", bullets: [] },
    statements: [],
    strategy: {
      difficulty: { level: "moderate", why: ["Stub mode."] },
      exam_strategy: ["Use elimination based on core sources."],
      logical_deduction: ["Avoid overthinking; stick to NCERT."],
      ai_verdict: {
        recommendation: "attempt",
        rationale: "Stub mode.",
        confidence: 55,
      },
    },
  });
}

function toOfficialAnswer(x: unknown): "A" | "B" | "C" | "D" | null {
  const s = String(x ?? "")
    .trim()
    .toUpperCase();
  if (s === "A" || s === "B" || s === "C" || s === "D") return s;
  return null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("questionId");
    const questionId = idParam ? Number(idParam) : NaN;

    if (!Number.isFinite(questionId) || questionId <= 0) {
      return NextResponse.json({ error: "Invalid questionId" }, { status: 400 });
    }

    // If no OpenAI key, return stub
    if (!process.env.OPENAI_API_KEY) {
      console.warn("OPENAI_API_KEY missing – using stub analysis");
      return NextResponse.json(getStubAnalysis(questionId));
    }

    // Fetch question + correct key from Supabase
    const { data: question, error } = await supabaseServerClient
      .from("questions")
      .select(
        "id, question_text, option_a, option_b, option_c, option_d, correct_option"
      )
      .eq("id", questionId)
      .single();

    if (error || !question) {
      console.error("Supabase question error:", error);
      return NextResponse.json(
        { error: "Question not found in Supabase" },
        { status: 404 }
      );
    }

    const officialAnswer = toOfficialAnswer(question.correct_option);
    if (!officialAnswer) {
      return NextResponse.json(
        { error: "Correct option missing/invalid for this question in DB." },
        { status: 400 }
      );
    }

    const analysis = await generateQuestionAnalysis({
      questionText: question.question_text ?? "",
      options: {
        A: question.option_a ?? "",
        B: question.option_b ?? "",
        C: question.option_c ?? "",
        D: question.option_d ?? "",
      },
      officialAnswer,
    });

    return NextResponse.json(analysis);
  } catch (err: any) {
    console.error("🔥 Error in /test-ai route");
    console.error(err);

    return NextResponse.json(
      {
        error: "Failed to generate analysis",
        details: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
