import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, locked, sessionOk } from "@/lib/auth";
import { RESERVED_FEEDS } from "@/lib/feeds";
import { publicUrl } from "@/lib/url";

// Exactly one segment, after stripping one trailing slash. Kept percent-encoded: the route's
// [feed] param is decoded by Next and handlePost rejects anything outside FEED_RE ("a%2Fb" → "a/b" → 400).
const ONE_SEGMENT = /^\/([^/]+)\/?$/;

// Reserved names are the app's own paths (e.g. the plain <form method="post" action="/logout">).
function isReserved(segment: string): boolean {
  try {
    return RESERVED_FEEDS.has(decodeURIComponent(segment));
  } catch {
    return false; // malformed escape: not a reserved path; the handler answers 400
  }
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // POST /<feed> → the notes route. Server actions also POST to page URLs: with JS they carry
  // next-action; without JS React submits multipart/form-data, which the API would 415 anyway.
  const m = ONE_SEGMENT.exec(pathname);
  if (
    m &&
    req.method === "POST" &&
    !isReserved(m[1]) &&
    !req.headers.has("next-action") &&
    !req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")
  ) {
    // The handler checks the bearer password itself.
    return NextResponse.rewrite(new URL(`/api/feeds/${m[1]}/notes`, req.url));
  }

  if (!locked() || pathname === "/login" || /^\/(r|_next|api\/feeds)\//.test(pathname)) return NextResponse.next();
  if (sessionOk(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  // Must be absolute (Next rejects a relative Location here); built from the public base,
  // not req.url, so it is right behind a reverse proxy.
  return NextResponse.redirect(new URL("/login", publicUrl(req.headers)));
}

// /r/** (read-only feeds) and Next's assets never need the password; skip the proxy there (also exempted above).
export const config = {
  matcher: "/((?!r/|_next/|favicon\\.ico).*)",
};
