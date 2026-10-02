// Reading requests, for the handlers in backend/http.
import { AuthError, NotefeedError, RateLimitedError } from "../errors";
import { IDENTITY_COOKIE, SESSION_COOKIE, bearerOf, checkBearer, identitySender, locked, sessionOk } from "../auth";
import { type FeedAccess, feedCookieName } from "../feedlock";
import { assertFeed } from "../feeds";
import { clientIp } from "../limits";
import { identityOn } from "../oidc/config";
import { verify } from "../oauth/tokens";
import { publicUrl } from "../urls";
import { errorResponse } from "./errors";

// Reads at most `max` bytes; null (and the stream cancelled) as soon as the body is larger. A body that ends
// before the Content-Length it declared was cut short on its way (a proxy's buffer limit, a dropped
// connection): null too, so it is never stored. Content-Length can be absent (chunked) or too large for
// the cap's sake, so it is never trusted for the cap.
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = req.headers.get("content-length");
  if (Number(declared) > max) return null;
  const out = new Uint8Array(max);
  let size = 0;
  if (!req.body) return declared !== null && Number(declared) > 0 ? null : out.subarray(0, 0);
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return declared !== null && size < Number(declared) ? null : out.subarray(0, size);
    if (size + value.byteLength > max) {
      await reader.cancel();
      return null;
    }
    out.set(value, size);
    size += value.byteLength;
  }
}

// The content type without parameters, lower case; "" when absent.
export const mediaType = (h: Headers) => (h.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

// Form fields from an already-read body (multipart or urlencoded), parsed by the platform.
export const parseForm = (bytes: Uint8Array, h: Headers) =>
  new Response(bytes as BodyInit, { headers: { "content-type": h.get("content-type") ?? "" } }).formData();

// A small form post's fields; null when the body is too large or not a form.
export async function readFields(req: Request, max: number): Promise<FormData | null> {
  const bytes = await readCapped(req, max);
  return bytes ? parseForm(bytes, req.headers).catch(() => null) : null;
}

export function cookie(h: Headers, name: string): string | undefined {
  for (const part of (h.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

// A browser on this instance's own pages: the Origin's host is the public host. Browsers send Origin
// on every POST, so a missing one is not same-origin.
export function sameOrigin(h: Headers): boolean {
  const origin = h.get("origin");
  return origin !== null && URL.canParse(origin) && new URL(origin).host === new URL(publicUrl(h)).host;
}

// A browser navigating (a plain form post) rather than a script or fetch() asking for JSON.
export const wantsHtml = (h: Headers) => (h.get("accept") ?? "").includes("text/html");

// `headers` may repeat a name (two Set-Cookie).
export function seeOther(location: string, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("Location", location);
  return new Response(null, { status: 303, headers: h });
}

// A refused form post goes back to `page` (which may have a query) with error=<code>[&retry=n]; anything but
// a domain error is a bug.
export function errorRedirect(page: string, e: unknown): Response {
  if (!(e instanceof NotefeedError)) throw e;
  const retry = e instanceof RateLimitedError ? `&retry=${e.retryAfter}` : "";
  return seeOther(`${page}${page.includes("?") ? "&" : "?"}error=${e.code}${retry}`);
}

// Scripts send the bearer password. The web UI sends a session cookie (password or identity) instead, accepted only from
// this instance's own pages: a cross-site form would carry no cookie (SameSite=Lax), and the Origin
// check covers browsers that would. Throws AuthError or TooManyAttemptsError.
export function authorize(h: Headers, ip: string): void {
  if (!locked()) return;
  if (!h.has("authorization") && sameOrigin(h) && sessionOk(cookie(h, SESSION_COOKIE), cookie(h, IDENTITY_COOKIE))) return;
  checkBearer(h.get("authorization"), ip);
}

// The feed password header, or (like the instance cookie) the feed's unlock cookie from this instance's own pages.
// An empty header is no header: that is what curl sends for -H "X-Feed-Password: $UNSET" (nothing at all).
export function feedAccess(h: Headers, feed: string): FeedAccess {
  const password = h.get("x-feed-password") || undefined;
  const cookieOk = password === undefined && sameOrigin(h);
  return { password, cookie: cookieOk ? cookie(h, feedCookieName(feed)) : undefined };
}

// One of the web UI's plain forms for changing a feed or a note. Runs `act` once the post is known to come from
// this instance's own page by someone who may use the instance; a refusal goes back to `page`. `onGone` answers
// when the thing is already deleted (a double click): the goal is met.
export async function formPost(req: Request, feed: string, page: string, act: (h: Headers, ip: string) => Promise<Response>, onGone?: () => Response): Promise<Response> {
  const h = req.headers;
  try {
    assertFeed(feed); // before anything touches the disk
    // Only this instance's own pages may send these: another site's form must not change anything with a visitor's cookies.
    if (!sameOrigin(h)) throw new AuthError();
    const ip = clientIp(h);
    authorize(h, ip);
    return await act(h, ip);
  } catch (e) {
    if (!(e instanceof NotefeedError)) throw e;
    if (["invalid_feed", "reserved_feed"].includes(e.code)) return errorResponse(e);
    if (e.code === "not_found" && onGone) return onGone();
    return errorRedirect(page, e);
  }
}

// The verified sender of a request, or undefined: from the identity cookie, honoured like the session cookie
// in authorize (same origin, no Authorization header), or from an unexpired OAuth access token. Only while
// identity mode is on; never from the request body. Callers must already have checked the access token's audience.
export function sender(h: Headers): string | undefined {
  if (!identityOn()) return undefined;
  if (!h.has("authorization")) return sameOrigin(h) ? identitySender(cookie(h, IDENTITY_COOKIE)) : undefined;
  return verify("access", bearerOf(h.get("authorization")))?.sender;
}
