import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin, addCredits } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !whSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const stripe = new Stripe(secret);
  const signature = req.headers.get("stripe-signature") ?? "";
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, whSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Bad signature: ${msg}` }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id;
    const packId = session.metadata?.pack_id;
    const credits = parseInt(session.metadata?.credits ?? "0", 10);

    if (!userId || !packId || !credits) {
      return NextResponse.json({ error: "missing metadata" }, { status: 400 });
    }

    const db = supabaseAdmin();
    // Idempotency — bail if we've already processed this session
    const { data: existing } = await db
      .from("purchases")
      .select("id")
      .eq("stripe_session_id", session.id)
      .maybeSingle();
    if (existing) return NextResponse.json({ received: true, idempotent: true });

    await db.from("purchases").insert({
      user_id: userId,
      stripe_session_id: session.id,
      stripe_payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : null,
      pack_name: packId,
      credits,
      amount_thb: Math.round((session.amount_total ?? 0) / 100),
      status: "succeeded",
    });

    await addCredits(userId, credits);
  }

  return NextResponse.json({ received: true });
}
