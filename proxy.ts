import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionOk } from "@/lib/auth";

// UI pages need the session cookie. /api checks its bearer token itself; /feed.xml and /login are public.
export function proxy(req: NextRequest) {
  if (sessionOk(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: "/((?!login|feed\\.xml|api/|_next/|favicon\\.ico).*)",
};
