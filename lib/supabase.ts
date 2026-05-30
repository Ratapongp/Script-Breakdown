import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client using the service role key.
// This bypasses RLS — only call from API routes, never from the client.
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface DBUser {
  id: string;
  clerk_id: string;
  email: string | null;
  credits: number;
  total_credits_purchased: number;
  total_parses: number;
  created_at: string;
  updated_at: string;
}

// Get or create the DB user record for a Clerk user.
export async function getOrCreateUser(
  clerkId: string,
  email: string | null,
): Promise<DBUser> {
  const db = supabaseAdmin();

  const { data: existing } = await db
    .from("users")
    .select("*")
    .eq("clerk_id", clerkId)
    .single();

  if (existing) return existing as DBUser;

  const { data: created, error } = await db
    .from("users")
    .insert({ clerk_id: clerkId, email })
    .select()
    .single();

  if (error || !created) {
    throw new Error(`Failed to create user: ${error?.message ?? "no data"}`);
  }
  return created as DBUser;
}

// Atomically check and deduct credits. Returns the new balance.
// Throws if balance is insufficient.
export async function deductCredits(
  userId: string,
  amount: number,
): Promise<number> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("deduct_credits", {
    p_user_id: userId,
    p_amount: amount,
  });
  // Fallback if RPC not yet installed — non-atomic but acceptable for low concurrency
  if (error) {
    const { data: u } = await db
      .from("users")
      .select("credits")
      .eq("id", userId)
      .single();
    if (!u || (u as { credits: number }).credits < amount) {
      throw new Error("Insufficient credits");
    }
    const newBalance = (u as { credits: number }).credits - amount;
    const { error: upErr } = await db
      .from("users")
      .update({ credits: newBalance, total_parses: { increment: 1 } as any })
      .eq("id", userId);
    if (upErr) throw new Error(upErr.message);
    return newBalance;
  }
  return data as number;
}

export async function addCredits(
  userId: string,
  amount: number,
): Promise<void> {
  const db = supabaseAdmin();
  const { data: u } = await db
    .from("users")
    .select("credits, total_credits_purchased")
    .eq("id", userId)
    .single();
  const current = (u as { credits: number; total_credits_purchased: number } | null);
  await db
    .from("users")
    .update({
      credits: (current?.credits ?? 0) + amount,
      total_credits_purchased: (current?.total_credits_purchased ?? 0) + amount,
    })
    .eq("id", userId);
}
