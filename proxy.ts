import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, locked, publicUrl, sessionOk } from "@/backend";

// Exactly one segment, after stripping one trailing slash. Kept percent-encoded: the route's
// [feed] param is decoded by Next and the handler rejects anything outside FEED_RE ("a%2Fb" → "a/b" → 400).
const ONE_SEGMENT = /^\/([^/]+)\/?$/;

// Pages are GET-only; every POST is a backend route handler. /<feed> and /login are also pages, and
// Next can't put a route handler next to a page, so their POSTs are rewritten. Method and path decide,
// never headers: the same rule a reverse proxy would apply if the backend moved out.
function postTarget(pathname: string): string | null {
  const seg = ONE_SEGMENT.exec(pathname)?.[1];
  if (seg === undefined || seg === "logout") return null; // /logout is a route handler itself
  return seg === "login" ? "/api/login" : `/api/feeds/${seg}/notes`; // reserved names get the handler's 400
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (req.method === "POST") {
    if (pathname === "/") return Response.json({ error: "no feed in URL" }, { status: 404 });
    const target = postTarget(pathname);
    if (target) return NextResponse.rewrite(new URL(target, req.url));
  }

  // next.config.ts sets skipTrailingSlashRedirect so POST /<feed>/ reaches the rewrite above;
  // everything else keeps Next's usual 308 to the path without the slash.
  if (pathname !== "/" && pathname.endsWith("/")) {
    return NextResponse.redirect(new URL(pathname.slice(0, -1) + search, publicUrl(req.headers)), 308);
  }

  // /api/** is exempt from the lock because each handler checks credentials itself;
  // redirecting it to /login would turn a script's 401 into a success-looking 307.
  if (!locked() || pathname === "/login" || /^\/(r|_next|api)\//.test(pathname)) return NextResponse.next();
  if (sessionOk(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  // Must be absolute (Next rejects a relative Location here); built from the public base,
  // not req.url, so it is right behind a reverse proxy.
  const login = new URL("/login", publicUrl(req.headers));
  if (pathname !== "/") login.searchParams.set("next", pathname + search); // checked by safeNext after login
  return NextResponse.redirect(login);
}

// /r/** (read-only feeds) and Next's assets never need the password; skip the proxy there (also exempted above).
export const config = {
  matcher: "/((?!r/|_next/|favicon\\.ico).*)",
};
