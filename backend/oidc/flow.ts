// The OIDC relying party: discovery, the authorize URL (code + PKCE S256, state, nonce), and the code
// exchange with the id_token's claims checked. Every failure is an AuthError; the routes word it.
import { config } from "../config";
import { AuthError } from "../errors";
import { processState } from "../state";
import { allowed, senderFrom } from "./config";

export type Meta = { issuer: string; authorization_endpoint: string; token_endpoint: string };
type Fetch = typeof fetch;

const HOUR = 3_600_000;
const cache = processState("oidc-discovery", () => ({ issuer: "", at: 0, meta: null as Meta | null }));
export const resetDiscoveryForTests = (): void => void (cache.meta = null);

// The JSON object a provider answers with; anything else (unreachable, non-2xx, not JSON, not an object) refuses.
async function getJson(fetchFn: Fetch, url: string, init: RequestInit): Promise<Record<string, unknown>> {
  try {
    const res = await fetchFn(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
    const body: unknown = res.ok ? await res.json() : null;
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {}
  throw new AuthError();
}

const isUrl = (v: unknown): v is string => typeof v === "string" && URL.canParse(v);

export async function discover(issuer: string, fetchFn: Fetch = fetch, now = Date.now()): Promise<Meta> {
  if (cache.meta && cache.issuer === issuer && now - cache.at < HOUR) return cache.meta;
  const doc = await getJson(fetchFn, `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, { headers: { accept: "application/json" } });
  // Exact, as OIDC Discovery 4.3 requires: a document naming another issuer is not this provider's.
  if (doc.issuer !== issuer || !isUrl(doc.authorization_endpoint) || !isUrl(doc.token_endpoint)) throw new AuthError();
  const meta = { issuer, authorization_endpoint: doc.authorization_endpoint, token_endpoint: doc.token_endpoint };
  Object.assign(cache, { issuer, at: now, meta });
  return meta;
}

export function authorizeUrl(meta: Meta, p: { redirectUri: string; state: string; nonce: string; challenge: string }): string {
  const u = new URL(meta.authorization_endpoint);
  const q = { response_type: "code", client_id: config.oidc().clientId, redirect_uri: p.redirectUri, scope: "openid profile email", state: p.state, nonce: p.nonce, code_challenge: p.challenge, code_challenge_method: "S256" };
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return u.href;
}

// The id_token's payload, unverified: see the ponytail note in exchange.
function payload(idToken: unknown): Record<string, unknown> {
  const parts = typeof idToken === "string" ? idToken.split(".") : [];
  if (parts.length !== 3) throw new AuthError();
  try {
    const c: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (c && typeof c === "object" && !Array.isArray(c)) return c as Record<string, unknown>;
  } catch {}
  throw new AuthError();
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

// OIDC Core 3.1.3.7: issuer, audience (azp whenever there are several, or one is given), expiry, nonce; then the allow-list.
function check(c: Record<string, unknown>, meta: Meta, nonce: string, now: number): string {
  const { clientId } = config.oidc();
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  const audOk = aud.includes(clientId) && (aud.length === 1 || c.azp === clientId) && (c.azp === undefined || c.azp === clientId);
  const expOk = typeof c.exp === "number" && c.exp * 1000 > now;
  if (c.iss !== meta.issuer || !audOk || !expOk || c.nonce !== nonce) throw new AuthError();
  const person = { name: str(c.name), email: str(c.email), email_verified: c.email_verified === true };
  const sender = senderFrom(person);
  if (!allowed(person) || sender === undefined) throw new AuthError();
  return sender;
}

export async function exchange(meta: Meta, p: { code: string; redirectUri: string; verifier: string; nonce: string }, fetchFn: Fetch = fetch, now = Date.now()): Promise<{ sender: string }> {
  const { clientId, clientSecret } = config.oidc();
  const body = new URLSearchParams({ grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, code_verifier: p.verifier, client_id: clientId, client_secret: clientSecret });
  const res = await getJson(fetchFn, meta.token_endpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body });
  // ponytail: the id_token's signature is not verified. It came straight from the token endpoint over TLS,
  // which OIDC Core 3.1.3.7 lets stand in for it. Verify against the provider's JWKS if tokens ever arrive another way.
  return { sender: check(payload(res.id_token), meta, p.nonce, now) };
}
