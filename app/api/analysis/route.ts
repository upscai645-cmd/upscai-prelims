// app/api/analysis/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerClient } from "@/lib/supabaseServer";
import { generateQuestionAnalysis } from "@/lib/generateQuestionAnalysis";
import { normalizeQuestionAnalysisV1 } from "@/lib/aiAnalysis";

export const runtime = "nodejs";

const LIFETIME_FREE = 25;
const DAILY_FREE_AFTER = 2;

function startOfTodayISO() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function toOfficialAnswer(x: unknown): "A" | "B" | "C" | "D" | null {
  const s = String(x ?? "").trim().toUpperCase();
  return s === "A" || s === "B" || s === "C" || s === "D" ? s : null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("questionId");
    const refresh = searchParams.get("refresh") === "1";
    const questionId = idParam ? Number(idParam) : NaN;

    if (!Number.isFinite(questionId) || questionId <= 0) {
      return NextResponse.json({ error: "Invalid questionId" }, { status: 400 });
    }

    // --- Auth ---
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
    }

    const { data: u, error: uErr } =
      await supabaseServerClient.auth.getUser(token);

    if (uErr || !u.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = u.user;

    // Token-scoped client (RLS-safe)
    const supabaseAuthed = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      }
    );

    // --- Pro check ---
    const { data: prof } = await supabaseAuthed
      .from("profiles")
      .select("is_pro")
      .eq("id", user.id)
      .maybeSingle();

    const isPro = !!prof?.is_pro;

    // --- Existing analysis ---
    const { data: existing } = await supabaseAuthed
      .from("question_analysis")
      .select("analysis, updated_at")
      .eq("user_id", user.id)
      .eq("question_id", questionId)
      .maybeSingle();

    if (!refresh && existing?.analysis) {
      return NextResponse.json({
        cached: true,
        analysis: normalizeQuestionAnalysisV1(existing.analysis),
        analysisUpdatedAt: existing.updated_at ?? null,
      });
    }

    // --- Quota (skip for Pro) ---
    if (!isPro) {
      const { count: lifetimeCount } = await supabaseAuthed
        .from("question_analysis")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      const lifetime = lifetimeCount ?? 0;

      if (lifetime >= LIFETIME_FREE) {
        const todayISO = startOfTodayISO();

        const { count: todayCount } = await supabaseAuthed
          .from("question_analysis")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .gte("created_at", todayISO);

        const remainingToday = DAILY_FREE_AFTER - (todayCount ?? 0);

        if (remainingToday <= 0) {
          return NextResponse.json(
            {
              error: "LIMIT_REACHED",
              message: "Daily AI analysis limit reached.",
            },
            { status: 402 }
          );
        }
      }
    }

    // --- Question ---
    const { data: question } = await supabaseAuthed
      .from("questions")
      .select(
        "id, question_text, option_a, option_b, option_c, option_d, correct_option"
      )
      .eq("id", questionId)
      .single();

    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    const officialAnswer = toOfficialAnswer(question.correct_option);
    if (!officialAnswer) {
      return NextResponse.json(
        { error: "Correct option invalid" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY missing" },
        { status: 500 }
      );
    }

    // --- Generate ---
    try {
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

      await supabaseAuthed.from("question_analysis").upsert(
        {
          user_id: user.id,
          question_id: questionId,
          analysis,
        },
        { onConflict: "user_id,question_id" }
      );

      return NextResponse.json({ cached: false, analysis });
    } catch (e: any) {
      console.error("Regeneration failed:", e);

      if (existing?.analysis) {
        return NextResponse.json({
          cached: true,
          analysis: normalizeQuestionAnalysisV1(existing.analysis),
          analysisUpdatedAt: existing.updated_at ?? null,
          warning: "Regeneration failed; showing last saved analysis",
        });
      }

      return NextResponse.json(
        { error: "Failed to generate analysis", details: e?.message ?? "Unknown" },
        { status: 500 }
      );
    }
  } catch (e) {
    console.error("analysis route fatal error", e);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
