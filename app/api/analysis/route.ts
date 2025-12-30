// app/api/analysis/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerClient } from "@/lib/supabaseServer";
import { generateQuestionAnalysis } from "@/lib/generateQuestionAnalysis";
import { normalizeQuestionAnalysisV1 } from "@/lib/aiAnalysis";

export const runtime = "nodejs";
function tlog(t0: number, label: string) {
  const ms = Math.round(performance.now() - t0);
  console.log(`[analysis] ${label} +${ms}ms`);
}

const LIFETIME_FREE = 25;
//const DAILY_FREE_AFTER = 2;

//function startOfTodayISO() {
//  const now = new Date();
//  now.setHours(0, 0, 0, 0);
//  return now.toISOString();
//}

function toOfficialAnswer(x: unknown): "A" | "B" | "C" | "D" | null {
  const s = String(x ?? "").trim().toUpperCase();
  return s === "A" || s === "B" || s === "C" || s === "D" ? s : null;
}

export async function GET(request: Request) {
  const t0 = performance.now();
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("questionId");
    const refreshParam = searchParams.get("refresh");
    const refresh = refreshParam === "1"; // ONLY "1" triggers regeneration
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

    const hadExisting = !!existing?.analysis;

    if (!refresh && existing?.analysis) {
      return NextResponse.json({
        ok: true,
        cached: true,
        analysis: normalizeQuestionAnalysisV1(existing.analysis),
        analysisUpdatedAt: existing.updated_at ?? null,
        // include quota/isPro if you want, but don't recompute heavy stuff here
      });
}

    // --- Quota (skip for Pro) ---
    // --- Quota (MVP): Free users can unlock only first 25 unique questions ---
    // Only enforce on NEW unlock (no existing row)
    if (!isPro && !hadExisting) {
      const { count: lifetimeCount } = await supabaseAuthed
        .from("question_analysis")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      const lifetime = lifetimeCount ?? 0;

      if (lifetime >= LIFETIME_FREE) {
        // ✅ Block immediately: no LLM call, no upsert
        return NextResponse.json({ error: "LIMIT_REACHED", isPro: false }, { status: 402 });
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

      return NextResponse.json({ 
        ok: true,
        cached: false, 
        quotaSpent: !isPro && !hadExisting, // ✅ only the FIRST time this question is unlocked
        analysis });
    } catch (e: any) {
      console.error("Regeneration failed:", e);

      if (existing?.analysis) {
        return NextResponse.json({
          ok: true,
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
