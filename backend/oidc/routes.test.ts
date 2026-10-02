import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from "vitest";
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
// Each stub issuer and the client id it issues id_tokens to.
const CLIENTS: Record<string, string> = { [ISS]: "id", "https://alpha.example": "alpha-id", "https://beta.example": "beta-id" };
const stubImpl: typeof fetch = async (url) => {
  for (const [iss, aud] of Object.entries(CLIENTS)) {
    if (String(url) === `${iss}/.well-known/openid-configuration`) return Response.json({ issuer: iss, authorization_endpoint: `${iss}/authorize`, token_endpoint: `${iss}/token` });
    if (String(url) === `${iss}/token`) {
      const claims = { iss, aud, exp: Math.floor(Date.now() / 1000) + 300, nonce: lastNonce, ...person };
      return Response.json({ id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.c2ln` });
    }
  }
  return new Response("not found", { status: 404 });
};
const fetchStub = vi.fn<typeof fetch>(stubImpl);

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
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  warn.mockRestore();
});
// Failures log through console.warn; kept out of the test output, and read back by logged().
let warn: MockInstance<typeof console.warn>;
const logged = () => warn.mock.calls.map((c) => String(c[0]));

const get = (path: string, cookie?: string) => new Request(BASE + path, { headers: { ...H, ...(cookie ? { cookie } : {}) } });
const setCookie = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const valueOf = (c: string | undefined) => c?.slice(c.indexOf("=") + 1).split(";")[0];

// A string is the web GET's query; fields are the MCP authorize page's POST (from `origin`).
const postStart = (fields: Record<string, string>, origin: string | null = BASE) =>
  oidcStartRoute(
    new Request(`${BASE}/api/oidc/start`, {
      method: "POST",
      headers: { ...H, "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) },
      body: new URLSearchParams(fields),
    }),
  );
async function start(query: string | Record<string, string> = "next=/feed") {
  const res = await (typeof query === "string" ? oidcStartRoute(get(`/api/oidc/start?${query}`)) : postStart(query));
  const cookie = valueOf(setCookie(res, "nf_oidc"))!;
  const loc = res.headers.get("location") ? new URL(res.headers.get("location")!) : null;
  if (loc) lastNonce = loc.searchParams.get("nonce") ?? "";
  return { res, loc, cookie, state: loc?.searchParams.get("state") ?? "" };
}
// A registered client's checked authorize fields.
async function mcpFields(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const reg = await registerRoute(new Request(`${BASE}/oauth/register`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [CB] }) }));
  const client_id = (await reg.json()).client_id;
  return { response_type: "code", client_id, redirect_uri: CB, code_challenge: CHALLENGE, code_challenge_method: "S256", ...extra };
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
    expect(flight).toMatchObject({ state, nonce: lastNonce, next: "/feed", provider: "default" });
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

  test("a same-origin MCP POST keeps only the checked fields and goes to the provider", async () => {
    const fields = await mcpFields({ state: "s1" });
    const { res, loc, cookie } = await start({ ...fields, extra: "x", next: "/feed" });
    expect(res.status).toBe(303);
    expect(loc!.origin + loc!.pathname).toBe(META.authorization_endpoint);
    expect(verify("oidc", cookie)!.authorize).toEqual(fields);
  });

  const refused = (res: Response, status: number) => {
    expect(res.status).toBe(status);
    expect(res.headers.get("location")).toBeNull();
    expect(setCookie(res, "nf_oidc")).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  };

  test.each([["another site", "https://evil.example"], ["no Origin", null]])("an MCP POST from %s never reaches the provider", async (_, origin) => {
    refused(await postStart(await mcpFields(), origin), 403);
  });

  test("a GET carrying MCP authorize fields is refused, even valid ones", async () => {
    refused(await oidcStartRoute(get(`/api/oidc/start?${new URLSearchParams(await mcpFields())}`)), 400);
    for (const k of ["client_id", "redirect_uri", "code_challenge", "response_type", "state"]) refused(await oidcStartRoute(get(`/api/oidc/start?${k}=x`)), 400);
  });

  test("an MCP POST that doesn't check out never reaches the provider", async () => {
    refused(await postStart({ client_id: "forged", redirect_uri: CB }), 400);
    refused(await postStart({}), 400);
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
    const s = await start(await mcpFields({ state: "s1" }));
    const res = await callback(`code=c&state=${s.state}`, s.cookie);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(CB);
    expect(loc.searchParams.get("state")).toBe("s1");
    expect(verify("code", loc.searchParams.get("code")!)!.sender).toBe("Ann");
    expect(setCookie(res, IDENTITY_COOKIE)).toBeUndefined();
    expect(setCookie(res, "nf_oidc")).toMatch(/Max-Age=0/);
  });

  test("a failed MCP sign-in goes back to the authorize page", async () => {
    const fields = await mcpFields();
    const s = await start(fields);
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
    const cookie = sign("oidc", { state: "st", nonce: "no", verifier: "v", next: "/", provider: "default" }, Date.now() - 601_000);
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

describe("failure logs", () => {
  test.each([
    ["a wrong state", (s: { state: string; cookie: string }) => callback(`code=the-code&state=${s.state}x`, s.cookie), "oidc: state mismatch or missing sign-in cookie"],
    ["no cookie", (s: { state: string; cookie: string }) => callback(`code=the-code&state=${s.state}`), "oidc: state mismatch or missing sign-in cookie"],
    ["no code", (s: { state: string; cookie: string }) => callback(`state=${s.state}`, s.cookie), "oidc: no code in the callback"],
    ["a denial", (s: { state: string; cookie: string }) => callback(`error=access_denied&error_description=ann%40x.com+said+no&state=${s.state}`, s.cookie), 'oidc: provider denied the sign-in error="access_denied"'],
    ["a denial whose error isn't a short code", (s: { state: string; cookie: string }) => callback(`error=no%0Aoidc%3A+forged&state=${s.state}`, s.cookie), "oidc: provider denied the sign-in"],
    ["someone off the allow-list", (s: { state: string; cookie: string }) => ((person = { name: "Bob", email: "bob@x.com", email_verified: true }), callback(`code=the-code&state=${s.state}`, s.cookie)), 'oidc: person not on the allow-list provider="default"'],
  ])("%s logs one line saying why, and the browser sees only the plain failure", async (_, call, line) => {
    const s = await start("");
    failed(await call(s));
    expect(logged()).toEqual([line]);
    for (const secret of ["client-secret", "the-code", s.state, s.cookie, lastNonce, "ann@x.com", "bob@x.com", "Bob"]) expect(logged().join("\n")).not.toContain(secret);
  });

  test("an unreachable provider at the start is logged", async () => {
    fetchStub.mockImplementationOnce(async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } })));
    expect((await oidcStartRoute(get("/api/oidc/start"))).headers.get("location")).toBe("/login?error=sign_in_failed");
    expect(logged()).toEqual(['oidc: discovery failed provider="default" error="ENOTFOUND"']);
  });

  test("an unknown provider id that isn't id-shaped is not echoed", async () => {
    for (const id of ["Evil\nfake", "a b", "x".repeat(65), "ALPHA"]) {
      const res = await oidcStartRoute(get(`/api/oidc/start?provider=${encodeURIComponent(id)}`));
      expect(res.headers.get("location")).toBe("/login?error=sign_in_failed");
    }
    expect(logged()).toEqual(Array(4).fill("oidc: unknown provider"));
  });

  test("a discovery issuer that can't be turned into a string still gives the plain failure", async () => {
    fetchStub.mockImplementation(async () => Response.json({ ...META, issuer: { toString: 1 } }));
    vi.stubEnv("NOTEFEED_RATE_LIMIT", "1");
    try {
      expect((await oidcStartRoute(get("/api/oidc/start"))).headers.get("location")).toBe("/login?error=sign_in_failed");
      const cookie = sign("oidc", { state: "st", nonce: "no", verifier: "v", next: "/", provider: "default" });
      failed(await callback("code=c&state=st", cookie));
      expect((await callback("code=c&state=st", cookie)).headers.get("location")).toMatch(/^\/login\?error=too_many_attempts/);
    } finally {
      fetchStub.mockReset();
      fetchStub.mockImplementation(stubImpl);
    }
  });

  test("a console.warn that throws changes nothing the browser sees, and the failure still counts", async () => {
    warn.mockImplementation(() => {
      throw new Error("log down");
    });
    vi.stubEnv("NOTEFEED_RATE_LIMIT", "1");
    const s = await start("");
    failed(await callback(`code=c&state=${s.state}x`, s.cookie));
    expect((await callback(`code=c&state=${s.state}`, s.cookie)).headers.get("location")).toMatch(/^\/login\?error=too_many_attempts/);
    resetDiscoveryForTests();
    fetchStub.mockImplementationOnce(async () => Promise.reject(new TypeError("fetch failed")));
    expect((await oidcStartRoute(get("/api/oidc/start"))).headers.get("location")).toBe("/login?error=sign_in_failed");
  });

  test("a sign-in that works logs nothing", async () => {
    const s = await start("");
    expect(setCookie(await callback(`code=c&state=${s.state}`, s.cookie), IDENTITY_COOKIE)).toBeDefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("several providers", () => {
  beforeEach(() => {
    const set = (name: string, v: Record<string, string>) => Object.entries(v).forEach(([k, val]) => vi.stubEnv(`NOTEFEED_OIDC_${name}_${k}`, val));
    set("ALPHA", { ISSUER: "https://alpha.example", CLIENT_ID: "alpha-id", CLIENT_SECRET: "alpha-secret", ALLOW: "ann@x.com" });
    set("BETA", { ISSUER: "https://beta.example", CLIENT_ID: "beta-id", CLIENT_SECRET: "beta-secret", ALLOW: "@y.com", SENDER_CLAIM: "email" });
  });
  const tokenCall = () => fetchStub.mock.calls.find(([u]) => String(u).endsWith("/token"));

  test.each([
    ["alpha", "https://alpha.example", "alpha-id"],
    ["beta", "https://beta.example", "beta-id"],
    ["default", ISS, "id"],
  ])("start with provider=%s goes to that provider with its client id", async (id, iss, clientId) => {
    const { loc, cookie } = await start(`provider=${id}&next=/feed`);
    expect(loc!.origin + loc!.pathname).toBe(`${iss}/authorize`);
    expect(loc!.searchParams.get("client_id")).toBe(clientId);
    expect(loc!.searchParams.get("redirect_uri")).toBe(`${BASE}/api/oidc/callback`);
    expect(verify("oidc", cookie)).toMatchObject({ provider: id, next: "/feed" });
  });

  test.each(["next=/feed", "provider=&next=/feed", "provider=gamma&next=/feed", "provider=ALPHA&next=/feed", "provider=Default&next=/feed"])("%j is refused before anything is fetched", async (q) => {
    const res = await oidcStartRoute(get(`/api/oidc/start?${q}`));
    expect(res.status).toBe(303);
    expect(logged()).toEqual([q.includes("gamma") ? 'oidc: unknown provider provider="gamma"' : "oidc: unknown provider"]);
    expect(res.headers.get("location")).toBe("/login?error=sign_in_failed&next=%2Ffeed");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test("an unknown provider is refused even when only one is configured", async () => {
    vi.stubEnv("NOTEFEED_OIDC_ALPHA_ISSUER", "");
    vi.stubEnv("NOTEFEED_OIDC_BETA_ISSUER", "");
    const res = await oidcStartRoute(get("/api/oidc/start?provider=alpha"));
    expect(res.headers.get("location")).toBe("/login?error=sign_in_failed");
    expect(fetchStub).not.toHaveBeenCalled();
    expect((await start("provider=default")).loc!.origin).toBe(ISS);
  });

  test("provider=default is refused when only named providers are configured", async () => {
    vi.stubEnv("NOTEFEED_OIDC_ISSUER", "");
    const res = await oidcStartRoute(get("/api/oidc/start?provider=default"));
    expect(res.headers.get("location")).toBe("/login?error=sign_in_failed");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test("a single named provider works without the parameter", async () => {
    vi.stubEnv("NOTEFEED_OIDC_ISSUER", "");
    vi.stubEnv("NOTEFEED_OIDC_ALPHA_ISSUER", "");
    const { loc, cookie } = await start("next=/feed");
    expect(loc!.origin).toBe("https://beta.example");
    expect(verify("oidc", cookie)!.provider).toBe("beta");
  });

  test("an MCP POST names its provider in a hidden field; a missing or unknown one goes back to the authorize page", async () => {
    const fields = await mcpFields({ state: "s1" });
    const { loc, cookie } = await start({ ...fields, provider: "beta" });
    expect(loc!.origin + loc!.pathname).toBe("https://beta.example/authorize");
    expect(verify("oidc", cookie)).toMatchObject({ provider: "beta", authorize: fields });
    fetchStub.mockClear();
    for (const extra of [{}, { provider: "gamma" }] as Record<string, string>[]) {
      const res = await postStart({ ...fields, ...extra });
      expect(res.headers.get("location")).toBe(`/oauth/authorize?${new URLSearchParams(fields)}&error=sign_in_failed`);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    expect(fetchStub).not.toHaveBeenCalled();
    expect((await postStart({ ...fields, provider: "beta" }, "https://evil.example")).status).toBe(403);
  });

  test("the callback uses the cookie's provider, never the request's", async () => {
    person = { name: "Bob", email: "bob@y.com", email_verified: true };
    const s = await start("provider=beta&next=/feed");
    const res = await callback(`code=c&state=${s.state}&provider=alpha`, s.cookie);
    expect(res.headers.get("location")).toBe("/feed");
    expect(verify("identity", valueOf(setCookie(res, IDENTITY_COOKIE))!)!.sender).toBe("bob@y.com"); // beta's sender claim
    const [url, init] = tokenCall()!;
    expect(url).toBe("https://beta.example/token");
    const body = new URLSearchParams(String(init!.body));
    expect([body.get("client_id"), body.get("client_secret")]).toEqual(["beta-id", "beta-secret"]);
  });

  test("each provider's allow-list applies to its own sign-ins", async () => {
    let s = await start("provider=beta");
    failed(await callback(`code=c&state=${s.state}`, s.cookie)); // ann@x.com is alpha's, not beta's
    s = await start("provider=alpha");
    const res = await callback(`code=c&state=${s.state}`, s.cookie);
    expect(verify("identity", valueOf(setCookie(res, IDENTITY_COOKIE))!)!.sender).toBe("Ann");
  });

  test("an MCP sign-in through a named provider issues the code", async () => {
    const s = await start({ ...(await mcpFields({ state: "s1" })), provider: "alpha" });
    const loc = new URL((await callback(`code=c&state=${s.state}`, s.cookie)).headers.get("location")!);
    expect(verify("code", loc.searchParams.get("code")!)!.sender).toBe("Ann");
  });

  test("a flight whose provider is no longer configured signs nobody in, and counts as a failure", async () => {
    vi.stubEnv("NOTEFEED_RATE_LIMIT", "1");
    const s = await start("provider=alpha");
    vi.stubEnv("NOTEFEED_OIDC_ALPHA_ALLOW", "");
    fetchStub.mockClear();
    failed(await callback(`code=c&state=${s.state}`, s.cookie));
    expect(fetchStub).not.toHaveBeenCalled();
    expect(logged()).toEqual(['oidc: provider no longer configured provider="alpha"']);
    vi.stubEnv("NOTEFEED_OIDC_ALPHA_ALLOW", "ann@x.com");
    expect((await callback(`code=c&state=${s.state}`, s.cookie)).headers.get("location")).toMatch(/^\/login\?error=too_many_attempts/);
  });

  test("a flight cookie without a provider signs nobody in", async () => {
    const cookie = sign("oidc", { state: "st", nonce: "no", verifier: "v", next: "/" } as never);
    failed(await callback("code=c&state=st", cookie));
  });
});
