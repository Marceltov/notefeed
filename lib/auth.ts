// Optional instance password (NOTEFEED_PASSWORD): bearer for POST, HMAC cookie for the UI.
// Unset or empty → the instance is open and every check passes.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { authFailed, authWait } from "./limits";

export const SESSION_COOKIE = "nf_session";

const password = () => process.env.NOTEFEED_PASSWORD ?? "";

export const locked = () => password() !== "";

// Hash both sides so lengths match and timingSafeEqual never throws.
function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

// False when unlocked: there is no password to match.
export function passwordMatches(candidate: string): boolean {
  return locked() && safeEqual(candidate, password());
}

// "ok", "wrong", or seconds to wait: over the failed-attempt limit the password is not even compared.
export type Attempt = "ok" | "wrong" | number;

export function passwordAttempt(candidate: string, ip: string): Attempt {
  if (!locked()) return "wrong"; // nothing to guess, nothing to count
  const wait = authWait(ip);
  if (wait !== null) return wait;
  if (passwordMatches(candidate)) return "ok";
  authFailed(ip);
  return "wrong";
}

export function bearerAttempt(authorization: string | null, ip: string): Attempt {
  if (!locked()) return "ok";
  return passwordAttempt(/^Bearer (.+)$/.exec(authorization ?? "")?.[1] ?? "", ip);
}

export function sessionValue(): string {
  return createHmac("sha256", password()).update("notefeed-session").digest("hex");
}

export function sessionOk(cookie: string | undefined): boolean {
  if (!locked()) return true;
  return cookie !== undefined && safeEqual(cookie, sessionValue());
}
