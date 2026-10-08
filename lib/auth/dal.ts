import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "./session-token";

export async function isAuthenticated(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

/** Call at the top of every page data loader and Server Action. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAuthenticated())) redirect("/login");
}
