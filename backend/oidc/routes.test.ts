import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { IDENTITY_COOKIE, sessionOk } from "../auth";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { registerRoute } from "../oauth/routes";
import { resetTokensForTests, sign, verify } from "../oauth/tokens";
import { resetDiscoveryForTests } from "./flow";
import { oidcCallbackRoute, oidcStartRoute } from "./routes";

const BASE = "http://localhost:3000";
const H = { host: "localhost:3000" };
const ISS = "https://idp.example";
const META = { issuer: ISS, authorization_endpoint: `${ISS}/authorize`, token_endpoint: `${ISS}/token` };
const CB = "https://claude.ai/api/mcp/auth_callback";
const CHALLENGE = "a".repeat(43);

// The stub issuer signs whoever `person` names into an id_token carrying the nonce of the last start.
let person: Record<string, unknown>;
let lastNonce = "";
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const fetchStub = vi.fn<typeof fetch>(async (url) => {
  if (String(url) === `${ISS}/.well-known/openid-configuration`) return Response.json(META);
  if (String(url) === META.token_endpoint) {
    const claims = { iss: ISS, aud: "id", exp: Math.floor(Date.now() / 1000) + 300, nonce: lastNonce, ...person };
    return Response.json({ id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.c2ln` });
  }
  return new Response("not found", { status: 404 });
});

beforeEach(async () => {
  vi.stubEnv("DATA_DIR", await mkdtemp(join(tmpdir(), "notefeed-oidc-")));
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  vi.stubEnv("NOTEFEED_OIDC_ISSUER", ISS);
  vi.stubEnv("NOTEFEED_OIDC_CLIENT_ID", "id");
  vi.stubEnv("NOTEFEED_OIDC_CLIENT_SECRET", "client-secret");
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "ann@x.com");
  vi.stubGlobal("fetch", fetchStub);
  fetchStub.mockClear();
  person = { name: "Ann", email: "ann@x.com", email_verified: true };
  resetFeedsForTests();
  resetRateLimitsForTests();
  resetTokensForTests();
  resetDiscoveryForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const get = (path: string, cookie?: string) => new Request(BASE + path, { headers: { ...H, ...(cookie ? { cookie } : {}) } });
const setCookie = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const valueOf = (c: string | undefined) => c?.slice(c.indexOf("=") + 1).split(";")[0];

async function start(query = "next=/feed") {
  const res = await oidcStartRoute(get(`/api/oidc/start?${query}`));
  const cookie = valueOf(setCookie(res, "nf_oidc"))!;
  const loc = res.headers.get("location") ? new URL(res.headers.get("location")!) : null;
  if (loc) lastNonce = loc.searchParams.get("nonce") ?? "";
  return { res, loc, cookie, state: loc?.searchParams.get("state") ?? "" };
}
const callback = (query: string, cookie?: string) => oidcCallbackRoute(get(`/api/oidc/callback?${query}`, cookie && `nf_oidc=${cookie}`));
const failed = (res: Response) => {
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toMatch(/^\/login\?error=sign_in_failed/);
  expect(setCookie(res, IDENTITY_COOKIE)).toBeUndefined();
  expect(setCookie(res, "nf_oidc")).toMatch(/^nf_oidc=; Path=\/api\/oidc; Max-Age=0; HttpOnly; SameSite=Lax/);
};

test("both routes 404 while identity mode is off", async () => {
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "");
  vi.stubEnv("NOTEFEED_PASSWORD", "pw");
  expect((await oidcStartRoute(get("/api/oidc/start"))).status).toBe(404);
  expect((await oidcCallbackRoute(get("/api/oidc/callback?code=x&state=y"))).status).toBe(404);
  expect(fetchStub).not.toHaveBeenCalled();
});

describe("start", () => {
  test("redirects to the provider with PKCE S256, state and nonce, all kept in a signed cookie", async () => {
    const { res, loc, cookie, state } = await start();
    expect(res.status).toBe(303);
    expect(loc!.origin + loc!.pathname).toBe(META.authorization_endpoint);
    const flight = verify("oidc", cookie)!;
    expect(flight).toMatchObject({ state, nonce: lastNonce, next: "/feed" });
    expect(flight.authorize).toBeUndefined();
    expect(state).toMatch(/^[\w-]{22,}$/);
    expect(lastNonce).toMatch(/^[\w-]{22,}$/);
    expect(loc!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc!.searchParams.get("code_challenge")).toBe(createHash("sha256").update(flight.verifier).digest("base64url"));
    expect(loc!.searchParams.get("redirect_uri")).toBe(`${BASE}/api/oidc/callback`);
    expect(setCookie(res, "nf_oidc")).toMatch(/; Path=\/api\/oidc; Max-Age=600; HttpOnly; SameSite=Lax$/);
  });

  test("a fresh state and nonce each time", async () => {
    const [a, b] = [await start(), await start()];
    expect(a.state).not.toBe(b.state);
    expect(verify("oidc", a.cookie)!.nonce).not.toBe(verify("oidc", b.cookie)!.nonce);
  });

  test("the cookie is Secure when the public URL is https, and the redirect URI uses it", async () => {
    vi.stubEnv("PUBLIC_URL", "https://notes.example");
    const { res, loc } = await start();
    expect(setCookie(res, "nf_oidc")).toMatch(/; Secure$/);
    expect(loc!.searchParams.get("redirect_uri")).toBe("https://notes.example/api/oidc/callback");
  });

  test.each(["next=//evil.example", "next=https://evil.example", ""])("%j keeps next at /", async (q) => {
    expect(verify("oidc", (await start(q)).cookie)!.next).toBe("/");
  });

  test("an MCP authorize request keeps only the checked fields", async () => {
    const reg = await registerRoute(new Request(`${BASE}/oauth/register`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [CB] }) }));
    const client_id = (await reg.json()).client_id;
    const fields = { response_type: "code", client_id, redirect_uri: CB, code_challenge: CHALLENGE, code_challenge_method: "S256", state: "s1" };
    const { cookie } = await start(new URLSearchParams({ ...fields, extra: "x", next: "/feed" }).toString());
    expect(verify("oidc", cookie)!.authorize).toEqual(fields);
  });

  test("an MCP request that doesn't check out never reaches the provider", async () => {
    const bad = await oidcStartRoute(get(`/api/oidc/start?client_id=forged&redirect_uri=${encodeURIComponent(CB)}`));
    expect(bad.status).toBe(400);
    expect(setCookie(bad, "nf_oidc")).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test("an unreachable provider is a plain error", async () => {
    fetchStub.mockImplementationOnce(async () => Promise.reject(new TypeError("fetch failed")));
    const res = await oidcStartRoute(get("/api/oidc/start"));
    expect(res.headers.get("location")).toBe("/login?error=sign_in_failed");
  });
});

describe("callback", () => {
  test("signs the person in and returns to next; the flight cookie is cleared", async () => {
    const s = await start("next=/feed?x=1");
    const res = await callback(`code=c&state=${s.state}`, s.cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/feed?x=1");
    const id = setCookie(res, IDENTITY_COOKIE)!;
    expect(id).toMatch(/; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/);
    expect(verify("identity", valueOf(id)!)!.sender).toBe("Ann");
    expect(sessionOk(undefined, valueOf(id))).toBe(true);
    expect(setCookie(res, "nf_oidc")).toMatch(/^nf_oidc=; Path=\/api\/oidc; Max-Age=0/);
    const body = new URLSearchParams(String(fetchStub.mock.calls.find(([u]) => String(u) === META.token_endpoint)![1]!.body));
    expect(body.get("code")).toBe("c");
    expect(body.get("code_verifier")).toBe(verify("oidc", s.cookie)!.verifier);
  });

  test("the identity cookie is Secure on https", async () => {
    vi.stubEnv("PUBLIC_URL", "https://notes.example");
    const s = await start();
    const res = await callback(`code=c&state=${s.state}`, s.cookie);
    expect(setCookie(res, IDENTITY_COOKIE)).toMatch(/; Secure$/);
    expect(setCookie(res, "nf_oidc")).toMatch(/; Secure$/);
  });

  test("an MCP sign-in goes back to the client with a code carrying the sender", async () => {
    const reg = await registerRoute(new Request(`${BASE}/oauth/register`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [CB] }) }));
    const client_id = (await reg.json()).client_id;
    const s = await start(new URLSearchParams({ response_type: "code", client_id, redirect_uri: CB, code_challenge: CHALLENGE, code_challenge_method: "S256", state: "s1" }).toString());
    const res = await callback(`code=c&state=${s.state}`, s.cookie);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(CB);
    expect(loc.searchParams.get("state")).toBe("s1");
    expect(verify("code", loc.searchParams.get("code")!)!.sender).toBe("Ann");
    expect(setCookie(res, IDENTITY_COOKIE)).toBeUndefined();
    expect(setCookie(res, "nf_oidc")).toMatch(/Max-Age=0/);
  });

  test("a failed MCP sign-in goes back to the authorize page", async () => {
    const reg = await registerRoute(new Request(`${BASE}/oauth/register`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [CB] }) }));
    const client_id = (await reg.json()).client_id;
    const fields = { response_type: "code", client_id, redirect_uri: CB, code_challenge: CHALLENGE, code_challenge_method: "S256" };
    const s = await start(new URLSearchParams(fields).toString());
    const res = await callback(`error=access_denied&state=${s.state}`, s.cookie);
    expect(res.headers.get("location")).toBe(`/oauth/authorize?${new URLSearchParams(fields)}&error=sign_in_failed`);
  });

  test("a failed web sign-in keeps next", async () => {
    const s = await start("next=/feed");
    const res = await callback(`code=c&state=wrong`, s.cookie);
    expect(res.headers.get("location")).toBe("/login?error=sign_in_failed&next=%2Ffeed");
  });

  test.each([
    ["a wrong state", (s: { state: string; cookie: string }) => callback(`code=c&state=${s.state}x`, s.cookie)],
    ["no state", (s: { state: string; cookie: string }) => callback(`code=c`, s.cookie)],
    ["no code", (s: { state: string; cookie: string }) => callback(`state=${s.state}`, s.cookie)],
    ["no cookie", (s: { state: string; cookie: string }) => callback(`code=c&state=${s.state}`)],
    ["a forged cookie", (s: { state: string; cookie: string }) => callback(`code=c&state=${s.state}`, `${s.cookie}x`)],
    ["an error from the provider", (s: { state: string; cookie: string }) => callback(`error=access_denied&state=${s.state}`, s.cookie)],
  ])("%s signs nobody in", async (_, call) => {
    failed(await call(await start("")));
  });

  test("an expired flight cookie signs nobody in", async () => {
    const cookie = sign("oidc", { state: "st", nonce: "no", verifier: "v", next: "/" }, Date.now() - 601_000);
    failed(await callback("code=c&state=st", cookie));
  });

  test("someone off the allow-list is refused", async () => {
    person = { name: "Bob", email: "bob@x.com", email_verified: true };
    const s = await start("");
    failed(await callback(`code=c&state=${s.state}`, s.cookie));
  });

  test("failed callbacks count toward the failed-attempt limit", async () => {
    vi.stubEnv("NOTEFEED_RATE_LIMIT", "2");
    const s = await start("");
    for (let i = 0; i < 2; i++) failed(await callback(`code=c&state=wrong`, s.cookie));
    fetchStub.mockClear();
    const res = await callback(`code=c&state=${s.state}`, s.cookie);
    expect(res.headers.get("location")).toMatch(/^\/login\?error=too_many_attempts&retry=\d+/);
    expect(setCookie(res, IDENTITY_COOKIE)).toBeUndefined();
    expect(setCookie(res, "nf_oidc")).toMatch(/Max-Age=0/);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
