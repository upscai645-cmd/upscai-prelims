// app/api/payments/razorpay/order/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing in .env.local`);
  return v;
}

export async function POST() {
  try {
    const keyId = must("RAZORPAY_KEY_ID");
    const keySecret = must("RAZORPAY_KEY_SECRET");

    // MVP price: ₹399 (paise)
    const amount = 399 * 100;
    const receipt = `upscai_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const r = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt,
        payment_capture: 1,
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      return NextResponse.json(
        { error: "Failed to create order", details: data?.error?.description ?? data },
        { status: 500 }
      );
    }

    return NextResponse.json({
      orderId: data.id,
      amount: data.amount,
      currency: data.currency,
      keyId: keyId,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Order init failed", details: e?.message ?? "Unknown" },
      { status: 500 }
    );
  }
}
