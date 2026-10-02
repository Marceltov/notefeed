// GET /api/oidc/start and GET /api/oidc/callback: sign-in through one of the operator's OIDC providers. What a
// sign-in in flight needs (which provider, state, nonce, PKCE verifier, where to go next) rides in a short-lived
// signed cookie, so nothing is stored; the one callback URL serves every provider. Success sets the identity
// cookie, or, for an MCP client's authorize request, sends the browser back to that client with a code carrying
// the sender. 404 while the mode is off.
import { createHash, randomBytes } from "node:crypto";
import { IDENTITY_COOKIE, safeEqual } from "../auth";
import { AuthError } from "../errors";
import { cookie, readFields, sameOrigin, seeOther } from "../http/request";
import { authFailed, authWait, clientIp } from "../limits";
import { checkAuthorize, issueCode } from "../oauth/routes";
import { type Payloads, sign, TTL, verify } from "../oauth/tokens";
import { publicUrl, safeNext } from "../urls";
import { identityOn, type Provider, providerById, providers } from "./config";
import { authorizeUrl, discover, exchange } from "./flow";
import { errorCode, fail, log, logFailure } from "./log";

const FLIGHT_COOKIE = "nf_oidc";
const notFound = () => new Response("not found", { status: 404 });
const redirectUri = (h: Headers) => `${publicUrl(h)}/api/oidc/callback`;
const random = (bytes: number) => randomBytes(bytes).toString("base64url");

// Like the password session cookie (http/session.ts); the flight cookie only goes to these two routes.
function setCookie(h: Headers, name: string, value: string, maxAge: number, path = "/"): string {
  const secure = publicUrl(h).startsWith("https:") ? "; Secure" : "";
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}
const flightCookie = (h: Headers, value: string, maxAge: number) => setCookie(h, FLIGHT_COOKIE, value, maxAge, "/api/oidc");

// Where the sign-in started: the MCP client's authorize page, or the login page keeping next.
function failedPage(from: { next?: string; authorize?: Record<string, string> } | null, error: string): string {
  const next = safeNext(from?.next);
  return from?.authorize
    ? `/oauth/authorize?${new URLSearchParams(from.authorize)}&error=${error}`
    : `/login?error=${error}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`;
}
const failed = (from: Parameters<typeof failedPage>[0], error: string, h: Headers) => seeOther(failedPage(from, error), { "Set-Cookie": flightCookie(h, "", 0) });

// The provider a start names (by id); with only one configured, naming none means that one.
function chosen(id: string | null): Provider | undefined {
  if (id) return providerById(id);
  const all = providers();
  return all.length === 1 ? all[0] : undefined;
}

// Any of these on the GET means an MCP authorize request, which must come as the POST.
const MCP_FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "resource"];

// GET: the login page's plain link (?provider=&next=). POST: the MCP authorize page's form, from this instance's own pages
// only. There is no other consent step, so a cross-site navigation must never get a code issued for a client the
// person never saw (open registration lets anyone register one); only checkAuthorize's fields are kept.
async function startRequest(req: Request): Promise<{ next: string; authorize?: Record<string, string>; provider: string | null } | Response> {
  const h = req.headers;
  if (req.method !== "POST") {
    const params = new URL(req.url).searchParams;
    if (MCP_FIELDS.some((k) => params.has(k))) return new Response("An MCP sign-in starts from the authorize page's form.", { status: 400 });
    return { next: safeNext(params.get("next")), provider: params.get("provider") };
  }
  if (!sameOrigin(h)) return new Response("forbidden", { status: 403 });
  const params = new URLSearchParams();
  for (const [k, v] of (await readFields(req, 16 * 1024)) ?? []) if (typeof v === "string") params.append(k, v);
  const checked = checkAuthorize(params, h);
  if (checked.kind === "redirect") return seeOther(checked.location);
  if (checked.kind === "error") return new Response(checked.message, { status: 400 });
  return { next: "/", authorize: checked.fields, provider: params.get("provider") };
}

export async function oidcStartRoute(req: Request): Promise<Response> {
  if (!identityOn()) return notFound();
  const h = req.headers;
  const start = await startRequest(req);
  if (start instanceof Response) return start;
  const { next, authorize } = start;
  const provider = chosen(start.provider);
  // A missing or unknown provider: back where the sign-in started, with no flight and nothing fetched.
  if (!provider) {
    // The id only when it has a provider id's shape: requested text is never echoed.
    logFailure("unknown provider", /^[a-z0-9_]{1,64}$/.test(start.provider ?? "") ? { provider: start.provider! } : {});
    return seeOther(failedPage({ next, authorize }, "sign_in_failed"));
  }
  let meta;
  try {
    meta = await discover(provider);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    return failed({ next, authorize }, "sign_in_failed", h);
  }
  const flight = { state: random(16), nonce: random(16), verifier: random(32), provider: provider.id, next, ...(authorize ? { authorize } : {}) };
  // ponytail: an MCP client that registered many long redirect URIs makes this cookie exceed the browser's
  // 4 KB; the browser drops it and the callback refuses (fails closed). Keep only the client's hash if that bites.
  const to = authorizeUrl(provider, meta, { redirectUri: redirectUri(h), state: flight.state, nonce: flight.nonce, challenge: createHash("sha256").update(flight.verifier).digest("base64url") });
  return seeOther(to, { "Set-Cookie": flightCookie(h, sign("oidc", flight), TTL.oidc) });
}

// Throws AuthError (logging why) unless the provider's answer matches the flight and the person may sign in. The
// provider is the flight's (signed), never the request's; one no longer configured fails like any invalid flight.
async function signIn(params: URLSearchParams, flight: Payloads["oidc"] | null, h: Headers): Promise<string> {
  const [state, code] = [params.get("state"), params.get("code")];
  if (params.has("error")) fail("provider denied the sign-in", errorCode(params.get("error")));
  if (!flight || state === null || !safeEqual(state, flight.state)) fail("state mismatch or missing sign-in cookie");
  if (!code) fail("no code in the callback");
  const provider = typeof flight.provider === "string" ? providerById(flight.provider) : undefined;
  if (!provider) fail("provider no longer configured", typeof flight.provider === "string" ? { provider: flight.provider } : {});
  const meta = await discover(provider);
  return (await exchange(provider, meta, { code, redirectUri: redirectUri(h), verifier: flight.verifier, nonce: flight.nonce })).sender;
}

// Every failure counts toward the failed-password limit, which is checked before anything else.
export async function oidcCallbackRoute(req: Request): Promise<Response> {
  if (!identityOn()) return notFound();
  const h = req.headers;
  const ip = clientIp(h);
  const flight = verify("oidc", cookie(h, FLIGHT_COOKIE) ?? "");
  const wait = authWait(ip);
  if (wait !== null) return failed(flight, `too_many_attempts&retry=${wait}`, h);
  let sender: string;
  try {
    sender = await signIn(new URL(req.url).searchParams, flight, h);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    authFailed(ip);
    return failed(flight, "sign_in_failed", h);
  }
  log.info({ provider: flight!.provider }, "sign-in succeeded"); // which provider, never who
  const res = flight!.authorize
    ? issueCode(flight!.authorize, h, sender)
    : seeOther(safeNext(flight!.next), { "Set-Cookie": setCookie(h, IDENTITY_COOKIE, sign("identity", { sender }), TTL.identity) });
  res.headers.append("Set-Cookie", flightCookie(h, "", 0));
  return res;
}
