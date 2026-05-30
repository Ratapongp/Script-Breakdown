import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth-helpers";
import { getOrCreateUser } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (user.isAdmin) {
    return NextResponse.json({
      email: user.email,
      isAdmin: true,
      credits: Infinity,
      label: "ADMIN",
    });
  }

  try {
    const db = await getOrCreateUser(user.clerkId, user.email);
    return NextResponse.json({
      email: user.email,
      isAdmin: false,
      credits: db.credits,
      totalParses: db.total_parses,
      totalCreditsPurchased: db.total_credits_purchased,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
