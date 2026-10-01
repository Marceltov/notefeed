// Stateless OAuth tokens: base64url(JSON payload) "." base64url(HMAC-SHA256). The key is derived from the
// server secret and the password, so changing either one invalidates every token.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { secret } from "../feeds";
import { processState } from "../state";

export type Kind = "client" | "code" | "access" | "refresh";
export type Payloads = {
  client: { client_name?: string; redirect_uris: string[] };
  code: { cid: string; redirect_uri: string; code_challenge: string; resource: string; jti: string };
  access: { aud: string };
  refresh: { cid: string; aud: string; jti: string };
};
export const TTL = { code: 300, access: 3600, refresh: 2592000 } as const;

// Derived per call: secret() is cached, the password is not, and either may change.
function key(): Buffer {
  const pw = createHash("sha256").update(config.password() ?? "").digest();
  return createHmac("sha256", secret()).update(pw).digest();
}

const mac = (body: string) => createHmac("sha256", key()).update(body).digest();

export function sign<K extends Kind>(t: K, p: Payloads[K], now = Date.now()): string {
  const claims = t === "client" ? { ...p, t } : { ...p, t, exp: Math.floor(now / 1000) + TTL[t as Exclude<Kind, "client">] };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

export function verify<K extends Kind>(t: K, token: string, now = Date.now()): (Payloads[K] & { exp?: number }) | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const want = mac(body);
  const got = Buffer.from(sig, "base64url");
  // The round trip rejects non-canonical encodings (the last char of a 32-byte MAC has spare bits).
  if (got.length !== want.length || got.toString("base64url") !== sig || !timingSafeEqual(got, want)) return null;
  // Only a token we signed gets parsed and its claims trusted.
  let claims: { t?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (!claims || typeof claims !== "object" || claims.t !== t) return null;
  if (t !== "client" && !(typeof claims.exp === "number" && now <= claims.exp * 1000)) return null;
  return claims as Payloads[K] & { exp?: number };
}

export const cid = (clientId: string): string => createHash("sha256").update(clientId).digest("base64url").slice(0, 22);

export const newJti = (): string => randomBytes(16).toString("base64url");

// ponytail: used code/refresh jti are kept in memory; after a restart one could be replayed once within its lifetime. Persist them in DATA_DIR if that matters.
const state = processState("oauth-used", () => ({ used: new Map<string, number>() }));

// True the first time a jti is seen; `exp` is in seconds, and an expired entry is dropped (its token no longer verifies).
export function spendOnce(jti: string, exp: number, now = Date.now()): boolean {
  for (const [j, e] of state.used) if (e * 1000 < now) state.used.delete(j);
  if (state.used.has(jti)) return false;
  state.used.set(jti, exp);
  return true;
}

export const resetTokensForTests = (): void => state.used.clear();
