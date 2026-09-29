// Single shared secret (NOTEFEED_TOKEN): bearer for the API, HMAC cookie for the UI.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "nf_session";

const token = () => process.env.NOTEFEED_TOKEN ?? "";

// Hash both sides so lengths match and timingSafeEqual never throws.
function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

export function tokenMatches(candidate: string): boolean {
  return token() !== "" && safeEqual(candidate, token());
}

export function bearerOk(authorization: string | null): boolean {
  const m = /^Bearer (.+)$/.exec(authorization ?? "");
  return m !== null && tokenMatches(m[1]);
}

export function sessionValue(): string {
  return createHmac("sha256", token()).update("notefeed-session").digest("hex");
}

export function sessionOk(cookie: string | undefined): boolean {
  return token() !== "" && cookie !== undefined && safeEqual(cookie, sessionValue());
}
