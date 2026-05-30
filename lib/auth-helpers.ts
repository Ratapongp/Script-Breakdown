import { currentUser } from "@clerk/nextjs/server";

export interface AuthedUser {
  clerkId: string;
  email: string | null;
  isAdmin: boolean;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export async function getAuthedUser(): Promise<AuthedUser | null> {
  const u = await currentUser();
  if (!u) return null;
  const email = u.emailAddresses?.[0]?.emailAddress ?? null;
  return {
    clerkId: u.id,
    email,
    isAdmin: isAdminEmail(email),
  };
}
