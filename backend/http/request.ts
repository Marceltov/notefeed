// Reading requests, for the handlers in backend/http.
import { SESSION_COOKIE, checkBearer, locked, sessionOk } from "../auth";
import { publicUrl } from "../urls";

// Reads at most `max` bytes; null (and the stream cancelled) as soon as the body is larger.
// Content-Length can be absent (chunked) or wrong, so it is never trusted for the cap.
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (Number(req.headers.get("content-length")) > max) return null;
  const out = new Uint8Array(max);
  let size = 0;
  if (!req.body) return out.subarray(0, 0);
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out.subarray(0, size);
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

export const seeOther = (location: string, headers: HeadersInit = {}) =>
  new Response(null, { status: 303, headers: { ...Object.fromEntries(new Headers(headers)), Location: location } });

// Scripts send the bearer password. The web UI sends the session cookie instead, accepted only from
// this instance's own pages: a cross-site form would carry no cookie (SameSite=Lax), and the Origin
// check covers browsers that would. Throws AuthError or TooManyAttemptsError.
export function authorize(h: Headers, ip: string): void {
  if (!locked()) return;
  if (!h.has("authorization") && sameOrigin(h) && sessionOk(cookie(h, SESSION_COOKIE))) return;
  checkBearer(h.get("authorization"), ip);
}
