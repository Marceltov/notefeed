// GET /api/oidc/start and GET /api/oidc/callback: sign-in through the operator's OIDC provider. What a
// sign-in in flight needs (state, nonce, PKCE verifier, where to go next) rides in a short-lived signed
// cookie, so nothing is stored. Success sets the identity cookie, or, for an MCP client's authorize
// request, sends the browser back to that client with a code carrying the sender. 404 while the mode is off.
import { createHash, randomBytes } from "node:crypto";
import { IDENTITY_COOKIE, safeEqual } from "../auth";
import { config } from "../config";
import { AuthError } from "../errors";
import { cookie, seeOther } from "../http/request";
import { authFailed, authWait, clientIp } from "../limits";
import { checkAuthorize, issueCode } from "../oauth/routes";
import { type Payloads, sign, TTL, verify } from "../oauth/tokens";
import { publicUrl, safeNext } from "../urls";
import { identityOn } from "./config";
import { authorizeUrl, discover, exchange } from "./flow";

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
function failed(from: { next?: string; authorize?: Record<string, string> } | null, error: string, h: Headers): Response {
  const next = safeNext(from?.next);
  const page = from?.authorize
    ? `/oauth/authorize?${new URLSearchParams(from.authorize)}&error=${error}`
    : `/login?error=${error}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`;
  return seeOther(page, { "Set-Cookie": flightCookie(h, "", 0) });
}

// The MCP authorize page passes its request on (client_id present): only checkAuthorize's fields are kept.
function authorizeFields(params: URLSearchParams, h: Headers): Record<string, string> | Response | undefined {
  if (!params.has("client_id")) return undefined;
  const checked = checkAuthorize(params, h);
  if (checked.kind === "redirect") return seeOther(checked.location);
  if (checked.kind === "error") return new Response(checked.message, { status: 400 });
  return checked.fields;
}

export async function oidcStartRoute(req: Request): Promise<Response> {
  if (!identityOn()) return notFound();
  const h = req.headers;
  const params = new URL(req.url).searchParams;
  const authorize = authorizeFields(params, h);
  if (authorize instanceof Response) return authorize;
  const next = safeNext(params.get("next"));
  let meta;
  try {
    meta = await discover(config.oidc().issuer);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    return failed({ next, authorize }, "sign_in_failed", h);
  }
  const flight = { state: random(16), nonce: random(16), verifier: random(32), next, ...(authorize ? { authorize } : {}) };
  // ponytail: an MCP client that registered many long redirect URIs makes this cookie exceed the browser's
  // 4 KB; the browser drops it and the callback refuses (fails closed). Keep only the client's hash if that bites.
  const to = authorizeUrl(meta, { redirectUri: redirectUri(h), state: flight.state, nonce: flight.nonce, challenge: createHash("sha256").update(flight.verifier).digest("base64url") });
  return seeOther(to, { "Set-Cookie": flightCookie(h, sign("oidc", flight), TTL.oidc) });
}

// Throws AuthError unless the provider's answer matches the flight and the person may sign in.
async function signIn(params: URLSearchParams, flight: Payloads["oidc"] | null, h: Headers): Promise<string> {
  const [state, code] = [params.get("state"), params.get("code")];
  if (!flight || params.has("error") || state === null || !code || !safeEqual(state, flight.state)) throw new AuthError();
  const meta = await discover(config.oidc().issuer);
  return (await exchange(meta, { code, redirectUri: redirectUri(h), verifier: flight.verifier, nonce: flight.nonce })).sender;
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
  const res = flight!.authorize
    ? issueCode(flight!.authorize, h, sender)
    : seeOther(safeNext(flight!.next), { "Set-Cookie": setCookie(h, IDENTITY_COOKIE, sign("identity", { sender }), TTL.identity) });
  res.headers.append("Set-Cookie", flightCookie(h, "", 0));
  return res;
}
