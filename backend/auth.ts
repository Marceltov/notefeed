// Optional instance password (NOTEFEED_PASSWORD): bearer for POST, HMAC cookie for the UI.
// Unset or empty → the instance is open and every check passes.
// ponytail: the session is HMAC(password, constant): no expiry, logout only drops the browser's copy;
// a leaked cookie works until the password changes (see docs/configuration.md). Add an expiry to the signed value if that matters.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { AuthError, TooManyAttemptsError } from "./errors";
import { authFailed, authWait } from "./limits";

export const SESSION_COOKIE = "nf_session";

export const locked = () => config.password() !== "";

// Hash both sides so lengths match and timingSafeEqual never throws.
function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

// Over the failed-attempt limit the password is not even compared; only failures are counted.
export function checkPassword(candidate: string, ip: string): void {
  const wait = authWait(ip);
  if (wait !== null) throw new TooManyAttemptsError(wait);
  if (safeEqual(candidate, config.password())) return;
  authFailed(ip);
  throw new AuthError();
}

// The token of `Authorization: Bearer <token>` (scheme in any case, RFC 9110), or "" when there is none.
export const bearerOf = (authorization: string | null): string => /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1] ?? "";

// `Authorization: Bearer <password>` on a locked instance; anything passes on an open one.
export function checkBearer(authorization: string | null, ip: string): void {
  if (!locked()) return;
  checkPassword(bearerOf(authorization), ip);
}

const sessionValue = () => createHmac("sha256", config.password()).update("notefeed-session").digest("hex");

// The login form: returns the session cookie's value. An open instance has no password to log in with.
export function login(password: string, ip: string): string {
  if (!locked()) throw new AuthError();
  checkPassword(password, ip);
  return sessionValue();
}

export function sessionOk(cookie: string | undefined): boolean {
  if (!locked()) return true;
  return cookie !== undefined && safeEqual(cookie, sessionValue());
}
