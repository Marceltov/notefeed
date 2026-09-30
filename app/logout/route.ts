import { cookies } from "next/headers";
import { SESSION_COOKIE, locked } from "@/lib/auth";

export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  // Relative Location, so it stays correct behind a reverse proxy.
  return new Response(null, { status: 303, headers: { Location: locked() ? "/login" : "/" } });
}
