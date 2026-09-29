import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionOk } from "@/lib/auth";

// UI pages need the session cookie. /api checks its bearer token itself; /feed.xml and /login are public.
export function proxy(req: NextRequest) {
  if (sessionOk(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  // Relative Location, so it stays correct behind a reverse proxy.
  return new NextResponse(null, { status: 307, headers: { Location: "/login" } });
}

export const config = {
  matcher: "/((?!login|feed\\.xml|api/|_next/|favicon\\.ico).*)",
};
