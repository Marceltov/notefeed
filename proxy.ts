import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionOk } from "@/lib/auth";
import { publicUrl } from "@/lib/url";

// UI pages need the session cookie. /api checks its bearer token itself; /feed.xml and /login are public.
export function proxy(req: NextRequest) {
  if (sessionOk(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  // Must be absolute (Next rejects a relative Location here); built from the public base,
  // not req.url, so it is right behind a reverse proxy.
  return NextResponse.redirect(new URL("/login", publicUrl(req.headers)));
}

export const config = {
  matcher: "/((?!login|feed\\.xml|api/|_next/|favicon\\.ico).*)",
};
