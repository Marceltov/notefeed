import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, locked, publicUrl, sessionOk } from "@/backend";

// Exactly one segment, after stripping one trailing slash. Kept percent-encoded: the route's
// [feed] param is decoded by Next and the handler rejects anything outside FEED_RE ("a%2Fb" → "a/b" → 400).
const ONE_SEGMENT = /^\/([^/]+)\/?$/;

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const h = req.headers;

  // A POST from a script, which must never get a success-looking answer unless its note was stored.
  // Server actions also POST to page URLs: with JS they carry next-action; without JS the browser
  // submits multipart/form-data and asks for text/html. `curl -F` sends multipart with Accept */*,
  // so it goes to the handler and gets 415.
  const scriptPost =
    req.method === "POST" &&
    !h.has("next-action") &&
    !(h.get("content-type")?.toLowerCase().startsWith("multipart/form-data") && h.get("accept")?.includes("text/html"));

  if (scriptPost && pathname === "/") return Response.json({ error: "no feed in URL" }, { status: 404 });
  // POST /<feed> → the notes route, reserved names too (the handler answers 400), except /logout,
  // a real POST route (the plain <form method="post" action="/logout">). The handler checks the bearer password itself.
  const m = ONE_SEGMENT.exec(pathname);
  if (scriptPost && m && m[1] !== "logout") return NextResponse.rewrite(new URL(`/api/feeds/${m[1]}/notes`, req.url));

  // next.config.ts sets skipTrailingSlashRedirect so POST /<feed>/ reaches the rewrite above;
  // everything else keeps Next's usual 308 to the path without the slash.
  if (pathname !== "/" && pathname.endsWith("/")) {
    return NextResponse.redirect(new URL(pathname.slice(0, -1) + search, publicUrl(h)), 308);
  }

  // /api/feeds/** is exempt from the lock because the handler checks the bearer password itself;
  // redirecting it to /login would turn a script's 401 into a success-looking 307.
  if (!locked() || pathname === "/login" || /^\/(r|_next|api\/feeds)\//.test(pathname)) return NextResponse.next();
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
