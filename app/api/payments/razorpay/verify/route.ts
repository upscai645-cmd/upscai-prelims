// app/api/payments/razorpay/verify/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing`);
  return v;
}

export async function POST(request: Request) {
  try {
    /* ------------------ AUTH ------------------ */
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
    }

    const { data: u, error: uErr } =
      await supabaseServerClient.auth.getUser(token);

    if (uErr || !u.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = u.user;

    /* ------------------ BODY ------------------ */
    const body = await request.json().catch(() => null);
    const { orderId, paymentId, signature, amount = 39900, currency = "INR" } =
      body || {};

    if (!orderId || !paymentId || !signature) {
      return NextResponse.json(
        { error: "Missing payment fields" },
        { status: 400 }
      );
    }

    /* ------------------ VERIFY SIGNATURE ------------------ */
    const secret = must("RAZORPAY_KEY_SECRET");

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    if (expected !== signature) {
      console.error("Signature mismatch", {
        orderId,
        paymentId,
      });
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 400 }
      );
    }

    /* ------------------ ADMIN CLIENT ------------------ */
    const supabaseAdmin = createClient(
      must("NEXT_PUBLIC_SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    /* ------------------ INSERT PAYMENT (IDEMPOTENT) ------------------ */
    const { error: payErr } = await supabaseAdmin
      .from("payments")
      .upsert(
        [
          {
            user_id: user.id,
            order_id: orderId,
            payment_id: paymentId,
            signature,
            amount,
            currency,
            status: "captured",
          },
        ],
        { onConflict: "payment_id", ignoreDuplicates: true }
      );

    if (payErr) {
      console.error("Payment insert failed", payErr);
      return NextResponse.json(
        { error: "Payment record insert failed" },
        { status: 500 }
      );
    }

    /* ------------------ UPGRADE USER ------------------ */
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email: user.email ?? null,
          is_pro: true,
        },
        { onConflict: "id" }
      )
      .select("id, is_pro")
      .single();

    if (profErr) {
      console.error("Profile upgrade failed", profErr);
      return NextResponse.json(
        { error: "Failed to upgrade user" },
        { status: 500 }
      );
    }

    /* ------------------ SUCCESS ------------------ */
    return NextResponse.json({
      ok: true,
      isPro: true,
      profile,
    });
  } catch (e: any) {
    console.error("verify route crashed", e);
    return NextResponse.json(
      { error: "verify_failed", details: e?.message ?? "Unknown" },
      { status: 500 }
    );
  }
}
