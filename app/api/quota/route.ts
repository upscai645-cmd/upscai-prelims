// app/api/quota/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";

// Lifetime free analyses before paywall (adjust as you want)
const LIFETIME_FREE = 25;

function jsonNoStore(data: any, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET(request: Request) {
  try {
    // 1) Read Bearer token
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return jsonNoStore({ error: "Missing auth token" }, { status: 401 });
    }

    // 2) Validate token -> user
    const { data: u, error: uErr } = await supabaseServerClient.auth.getUser(token);
    if (uErr || !u?.user) {
      return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
    }
    const user = u.user;

    // 3) Token-scoped client (RLS-safe)
    const supabaseAuthed = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      }
    );

    // 4) Read profile.is_pro
    // IMPORTANT: In your project history, profiles.id may NOT always equal auth.user.id.
    // So we try id match first, then fallback to email match.
    let isPro = false;

    const { data: profById, error: profByIdErr } = await supabaseAuthed
      .from("profiles")
      .select("id,email,is_pro")
      .eq("id", user.id)
      .maybeSingle();

    if (!profByIdErr && profById) {
      isPro = !!profById.is_pro;
    } else if (user.email) {
      const { data: profByEmail, error: profByEmailErr } = await supabaseAuthed
        .from("profiles")
        .select("id,email,is_pro")
        .eq("email", user.email)
        .maybeSingle();

      if (!profByEmailErr && profByEmail) {
        isPro = !!profByEmail.is_pro;
      }
    }

    // 5) Lifetime usage = number of saved analyses
    // (Assumes question_analysis.user_id stores auth user id. If your column differs, change here.)
    const { count: lifetimeCount, error: countErr } = await supabaseAuthed
      .from("question_analysis")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    // If RLS blocks count or table/col mismatch, don’t crash quota endpoint.
    const lifetimeUsed = !countErr ? (lifetimeCount ?? 0) : 0;
    const lifetimeFreeRemaining = isPro ? 999999 : Math.max(0, LIFETIME_FREE - lifetimeUsed);

    return jsonNoStore({
      isPro,
      lifetimeUsed,
      lifetimeFreeRemaining,
    });
  } catch (e: any) {
    console.error("quota route error:", e);
    return jsonNoStore(
      { error: "quota_failed", details: e?.message ?? "Unknown" },
      { status: 500 }
    );
  }
}
