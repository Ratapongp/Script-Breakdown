import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getAuthedUser } from "@/lib/auth-helpers";
import { getOrCreateUser } from "@/lib/supabase";
import { findPack } from "@/lib/pricing";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { packId } = (await req.json()) as { packId?: string };
  const pack = packId ? findPack(packId) : undefined;
  if (!pack) return NextResponse.json({ error: "invalid pack id" }, { status: 400 });

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });

  const stripe = new Stripe(secret);
  const dbUser = await getOrCreateUser(user.clerkId, user.email);
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card", "promptpay"],
    line_items: [
      {
        price_data: {
          currency: "thb",
          product_data: {
            name: `${pack.name} Pack — ${pack.credits} credits`,
            description: `${pack.credits} screenplay parses (up to 50 pages each)`,
          },
          unit_amount: pack.amount,
        },
        quantity: 1,
      },
    ],
    customer_email: user.email ?? undefined,
    success_url: `${origin}/buy?success=1&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/buy?cancelled=1`,
    metadata: {
      user_id: dbUser.id,
      clerk_id: user.clerkId,
      pack_id: pack.id,
      credits: String(pack.credits),
    },
  });

  return NextResponse.json({ url: session.url });
}
