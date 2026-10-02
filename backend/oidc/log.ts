// Why a sign-in failed, for the operator: the browser only ever sees "Sign-in didn't work". One `oidc:` line per
// failure, a fixed reason plus key=value detail. Callers pass only provider ids, issuer URLs, HTTP statuses and short
// error codes: never a secret, code, token, state, nonce, verifier, cookie, address, name or other claim value.
import { AuthError } from "../errors";

type Detail = Record<string, string | number>;

// Quoted, without control, format or line-separator characters, so a value can't end the line or fake another one.
const value = (v: string | number) => (typeof v === "number" ? String(v) : JSON.stringify(v.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").slice(0, 200)));

// Never throws: a failing log must not change what the browser sees or what counts as a failed sign-in.
export function logFailure(reason: string, detail: Detail = {}): void {
  try {
    console.warn(`oidc: ${reason}${Object.entries(detail).map(([k, v]) => ` ${k}=${value(v)}`).join("")}`);
  } catch {}
}

// A URL as logged: without userinfo, query or fragment (they may carry credentials), or a placeholder if it isn't one.
export function logUrl(v: unknown): string {
  if (typeof v !== "string" || !URL.canParse(v)) return typeof v === "string" ? "(not a URL)" : typeof v;
  return v.replace(/[?#].*$/s, "").replace(/^([a-z][a-z\d+.-]*:\/\/)[^/]*@/i, "$1");
}

// Logs why, then refuses with the plain AuthError the routes word.
export function fail(reason: string, detail?: Detail): never {
  logFailure(reason, detail);
  throw new AuthError();
}

// A provider's error code (`invalid_client`, `access_denied`) when it is one; anything longer is left out.
export const errorCode = (v: unknown): Detail => (typeof v === "string" && /^[\w.-]{1,64}$/.test(v) ? { error: v } : {});
