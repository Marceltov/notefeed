import { afterEach, beforeEach, describe, expect, test, type MockInstance, vi } from "vitest";
import { AuthError } from "../errors";
import type { Provider } from "./config";
import { authorizeUrl, discover, exchange, resetDiscoveryForTests } from "./flow";

const ISS = "https://idp.example/app";
const META = { issuer: ISS, authorization_endpoint: "https://idp.example/authorize", token_endpoint: "https://idp.example/token" };
const NOW = 1_800_000_000_000;
const P = { code: "the-code", redirectUri: "https://notes.example/api/oidc/callback", verifier: "the-verifier", nonce: "the-nonce" };
const PROV: Provider = { id: "default", label: "", issuer: ISS, clientId: "id", clientSecret: "client-secret", allow: ["ann@x.com"], senderClaim: ["name", "email"] };
const at = (issuer: string) => ({ ...PROV, issuer });
const GOOD = { iss: ISS, aud: "id", exp: NOW / 1000 + 300, nonce: "the-nonce", name: " Ann ", email: "ann@x.com", email_verified: true };

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const jwt = (claims: unknown) => `${b64({ alg: "RS256" })}.${b64(claims)}.c2ln`;

// A stub issuer: the discovery document and a token endpoint answering with `claims` in the id_token.
function issuer(o: { doc?: unknown; claims?: unknown; tokenStatus?: number } = {}) {
  return vi.fn<typeof fetch>(async (url) => {
    if (String(url) === `${ISS}/.well-known/openid-configuration`) return Response.json(o.doc ?? META);
    if (String(url) === META.token_endpoint) {
      if (o.tokenStatus && o.tokenStatus !== 200) return Response.json({ error: "invalid_grant" }, { status: o.tokenStatus });
      return Response.json({ access_token: "at", token_type: "Bearer", id_token: jwt(o.claims ?? GOOD) });
    }
    return new Response("not found", { status: 404 });
  });
}

// Failures log through console.warn; kept out of the test output, and read back by logged().
let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  resetDiscoveryForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());
const logged = () => warn.mock.calls.map((c) => String(c[0]));

describe("discover", () => {
  test("reads the issuer's openid-configuration", async () => {
    const f = issuer();
    expect(await discover(PROV, f)).toEqual(META);
    expect(f).toHaveBeenCalledWith(`${ISS}/.well-known/openid-configuration`, expect.anything());
  });

  test("a trailing slash on the issuer is not doubled", async () => {
    const f = issuer({ doc: { ...META, issuer: `${ISS}/` } });
    await discover(at(`${ISS}/`), f);
    expect(f).toHaveBeenCalledWith(`${ISS}/.well-known/openid-configuration`, expect.anything());
  });

  test("is cached for an hour, per issuer", async () => {
    const f = issuer();
    await discover(PROV, f, NOW);
    await discover(PROV, f, NOW + 3599_000);
    expect(f).toHaveBeenCalledTimes(1);
    await discover(PROV, f, NOW + 3601_000);
    expect(f).toHaveBeenCalledTimes(2);
    resetDiscoveryForTests();
    await discover(PROV, f, NOW + 3601_000);
    expect(f).toHaveBeenCalledTimes(3);
  });

  test("several issuers are cached side by side", async () => {
    const B = "https://other.example";
    const metaB = { issuer: B, authorization_endpoint: `${B}/authorize`, token_endpoint: `${B}/token` };
    const f = vi.fn<typeof fetch>(async (url) => Response.json(String(url).startsWith(B) ? metaB : META));
    expect(await discover(PROV, f, NOW)).toEqual(META);
    expect(await discover(at(B), f, NOW)).toEqual(metaB);
    expect(await discover(PROV, f, NOW)).toEqual(META);
    expect(await discover(at(B), f, NOW)).toEqual(metaB);
    expect(f).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["an issuer mismatch", { ...META, issuer: "https://evil.example" }],
    ["an issuer on another host", { ...META, issuer: "https://other.example/app" }],
    ["an issuer with another path", { ...META, issuer: `${ISS}/x` }],
    ["an issuer with another scheme", { ...META, issuer: "http://idp.example/app" }],
    ["an issuer with two trailing slashes", { ...META, issuer: `${ISS}//` }],
    ["no token endpoint", { ...META, token_endpoint: undefined }],
    ["an endpoint that isn't a URL", { ...META, authorization_endpoint: "nope" }],
    ["not an object", "x"],
  ])("refuses %s", async (_, doc) => {
    await expect(discover(PROV, issuer({ doc }))).rejects.toBeInstanceOf(AuthError);
  });

  test.each([
    ["without a slash, the document with one", ISS, `${ISS}/`],
    ["with a slash, the document without one", `${ISS}/`, ISS],
  ])("the issuer configured %s matches", async (_, configured, inDoc) => {
    const f = issuer({ doc: { ...META, issuer: inDoc } });
    const meta = await discover(at(configured), f);
    expect(f).toHaveBeenCalledWith(`${ISS}/.well-known/openid-configuration`, expect.anything());
    for (const iss of [ISS, `${ISS}/`]) expect(await exchange(at(configured), meta, P, issuer({ claims: { ...GOOD, iss } }), NOW)).toEqual({ sender: "Ann" });
  });

  test("an issuer with and without a trailing slash share one cache entry", async () => {
    const f = issuer();
    await discover(PROV, f, NOW);
    await discover(at(`${ISS}/`), f, NOW);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test("a plain http issuer is refused before anything is fetched", async () => {
    const f = issuer();
    await expect(discover(at("http://idp.example/app"), f)).rejects.toBeInstanceOf(AuthError);
    expect(f).not.toHaveBeenCalled();
  });

  test.each(["token_endpoint", "authorization_endpoint"])("a plain http %s is refused", async (k) => {
    await expect(discover(PROV, issuer({ doc: { ...META, [k]: "http://idp.example/x" } }))).rejects.toBeInstanceOf(AuthError);
  });

  test("plain http is fine on loopback", async () => {
    const local = { issuer: "http://localhost:9000/app", authorization_endpoint: "http://localhost:9000/authorize", token_endpoint: "http://127.0.0.1:9000/token" };
    const f = vi.fn<typeof fetch>(async () => Response.json(local));
    expect(await discover(at(local.issuer), f)).toEqual(local);
    expect(f).toHaveBeenCalledWith("http://localhost:9000/app/.well-known/openid-configuration", expect.anything());
  });

  test("an unreachable provider or a non-200 refuses", async () => {
    await expect(discover(PROV, vi.fn(async () => Promise.reject(new TypeError("fetch failed"))))).rejects.toBeInstanceOf(AuthError);
    await expect(discover(PROV, vi.fn(async () => new Response("down", { status: 503 })))).rejects.toBeInstanceOf(AuthError);
    await expect(discover(PROV, vi.fn(async () => new Response("<html>")))).rejects.toBeInstanceOf(AuthError);
  });
});

test("authorizeUrl asks for a code with PKCE S256, state and nonce", () => {
  const u = new URL(authorizeUrl(PROV, META, { redirectUri: P.redirectUri, state: "st", nonce: "no", challenge: "ch" }));
  expect(u.origin + u.pathname).toBe(META.authorization_endpoint);
  expect(Object.fromEntries(u.searchParams)).toEqual({
    response_type: "code",
    client_id: "id",
    redirect_uri: P.redirectUri,
    scope: "openid profile email",
    state: "st",
    nonce: "no",
    code_challenge: "ch",
    code_challenge_method: "S256",
  });
});

test("authorizeUrl and exchange use the given provider's client", async () => {
  const other = { ...PROV, clientId: "other-id", clientSecret: "other-secret", allow: ["*"] };
  expect(new URL(authorizeUrl(other, META, { redirectUri: P.redirectUri, state: "s", nonce: "n", challenge: "c" })).searchParams.get("client_id")).toBe("other-id");
  const f = issuer({ claims: { ...GOOD, aud: "other-id" } });
  expect(await exchange(other, META, P, f, NOW)).toEqual({ sender: "Ann" });
  const body = new URLSearchParams(String(f.mock.calls[0][1]?.body));
  expect([body.get("client_id"), body.get("client_secret")]).toEqual(["other-id", "other-secret"]);
  await expect(exchange(PROV, META, P, issuer({ claims: { ...GOOD, aud: "other-id" } }), NOW)).rejects.toBeInstanceOf(AuthError);
});

describe("exchange", () => {
  test("posts the code with the client secret and verifier, and returns the sender", async () => {
    const f = issuer();
    expect(await exchange(PROV, META, P, f, NOW)).toEqual({ sender: "Ann" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(META.token_endpoint);
    expect(init?.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: P.redirectUri,
      code_verifier: "the-verifier",
      client_id: "id",
      client_secret: "client-secret",
    });
  });

  test("falls back to the email without a name", async () => {
    expect(await exchange(PROV, META, P, issuer({ claims: { ...GOOD, name: undefined } }), NOW)).toEqual({ sender: "ann@x.com" });
  });

  test("the provider's sender claim picks the sender; the allow-list still needs a verified email", async () => {
    let prov = { ...PROV, senderClaim: ["sub"] };
    const claims = { ...GOOD, sub: "u-1", preferred_username: "ann" };
    expect(await exchange(prov, META, P, issuer({ claims }), NOW)).toEqual({ sender: "u-1" });
    expect(await exchange(prov, META, P, issuer({ claims: { ...claims, sub: undefined } }), NOW).catch((e) => e)).toBeInstanceOf(AuthError);
    await expect(exchange(prov, META, P, issuer({ claims: { ...claims, email_verified: false } }), NOW)).rejects.toBeInstanceOf(AuthError);
    prov = { ...PROV, senderClaim: ["preferred_username", "email"] };
    expect(await exchange(prov, META, P, issuer({ claims }), NOW)).toEqual({ sender: "ann" });
  });

  test("aud may be an array holding the client id; with several entries azp must be the client id", async () => {
    expect(await exchange(PROV, META, P, issuer({ claims: { ...GOOD, aud: ["id"] } }), NOW)).toEqual({ sender: "Ann" });
    expect(await exchange(PROV, META, P, issuer({ claims: { ...GOOD, aud: ["id", "other"], azp: "id" } }), NOW)).toEqual({ sender: "Ann" });
  });

  test("anyone on a * list, even without an email", async () => {
    expect(await exchange({ ...PROV, allow: ["*"] }, META, P, issuer({ claims: { ...GOOD, email: undefined, email_verified: undefined } }), NOW)).toEqual({ sender: "Ann" });
  });

  test.each([
    ["wrong iss", { ...GOOD, iss: "https://evil.example" }],
    ["iss on another host", { ...GOOD, iss: "https://other.example/app" }],
    ["iss with another path", { ...GOOD, iss: `${ISS}/x` }],
    ["iss with another scheme", { ...GOOD, iss: "http://idp.example/app" }],
    ["iss with two trailing slashes", { ...GOOD, iss: `${ISS}//` }],
    ["wrong aud", { ...GOOD, aud: "other" }],
    ["aud array without the client id", { ...GOOD, aud: ["other"] }],
    ["several audiences and no azp", { ...GOOD, aud: ["id", "other"] }],
    ["several audiences and another azp", { ...GOOD, aud: ["id", "other"], azp: "other" }],
    ["azp of another client", { ...GOOD, azp: "other" }],
    ["expired", { ...GOOD, exp: NOW / 1000 - 1 }],
    ["no exp", { ...GOOD, exp: undefined }],
    ["wrong nonce", { ...GOOD, nonce: "other" }],
    ["no nonce", { ...GOOD, nonce: undefined }],
    ["email not verified", { ...GOOD, email_verified: false }],
    ["email_verified as a string", { ...GOOD, email_verified: "true" }],
    ["off the allow-list", { ...GOOD, email: "bob@x.com" }],
    ["no name or email", { ...GOOD, name: undefined, email: undefined }],
    ["a name that isn't a string", { ...GOOD, name: 5, email: undefined }],
    ["a payload that isn't an object", "x"],
  ])("refuses %s", async (_, claims) => {
    const prov = _ === "no name or email" || _ === "a name that isn't a string" ? { ...PROV, allow: ["*"] } : PROV;
    await expect(exchange(prov, META, P, issuer({ claims }), NOW)).rejects.toBeInstanceOf(AuthError);
  });

  test("a token endpoint error, a missing or malformed id_token refuses", async () => {
    await expect(exchange(PROV, META, P, issuer({ tokenStatus: 400 }), NOW)).rejects.toBeInstanceOf(AuthError);
    for (const body of [{}, { id_token: 5 }, { id_token: "a.b" }, { id_token: "a.!!.c" }])
      await expect(exchange(PROV, META, P, vi.fn(async () => Response.json(body)), NOW)).rejects.toBeInstanceOf(AuthError);
    await expect(exchange(PROV, META, P, vi.fn(async () => Promise.reject(new TypeError("fetch failed"))), NOW)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("failure logs", () => {
  const netError = (code?: string) => vi.fn(async () => Promise.reject(Object.assign(new TypeError("fetch failed"), code ? { cause: { code } } : {})));
  const D = 'provider="default"';
  test.each<[string, () => Promise<unknown>, string]>([
    ["a plain http issuer", () => discover(at("http://idp.example/app"), issuer()), `oidc: issuer is not an https URL ${D} issuer="http://idp.example/app"`],
    ["an unknown host", () => discover(PROV, netError("ENOTFOUND")), `oidc: discovery failed ${D} error="ENOTFOUND"`],
    ["a network error without a code", () => discover(PROV, netError()), `oidc: discovery failed ${D} error="TypeError"`],
    ["a non-200 discovery", () => discover(PROV, vi.fn(async () => new Response("down", { status: 503 }))), `oidc: discovery failed ${D} status=503`],
    ["a discovery document that isn't JSON", () => discover(PROV, vi.fn(async () => new Response("<html>"))), `oidc: discovery failed ${D} status=200 error="not a JSON object"`],
    ["another issuer in the document", () => discover(PROV, issuer({ doc: { ...META, issuer: "https://evil.example" } })), `oidc: issuer does not match the discovery document ${D} issuer="${ISS}" document="https://evil.example"`],
    ["a plain http token endpoint", () => discover(PROV, issuer({ doc: { ...META, token_endpoint: "http://idp.example/token" } })), `oidc: discovery endpoint is not https ${D} endpoint="token_endpoint"`],
    ["a missing authorize endpoint", () => discover(PROV, issuer({ doc: { ...META, authorization_endpoint: undefined } })), `oidc: discovery endpoint is not https ${D} endpoint="authorization_endpoint"`],
    ["a token request refused", () => exchange(PROV, META, P, issuer({ tokenStatus: 400 }), NOW), `oidc: token request rejected ${D} status=400 error="invalid_grant"`],
    ["a token request unreachable", () => exchange(PROV, META, P, netError("ECONNREFUSED"), NOW), `oidc: token request rejected ${D} error="ECONNREFUSED"`],
    ["no id_token", () => exchange(PROV, META, P, vi.fn(async () => Response.json({ access_token: "at" })), NOW), `oidc: token response has no id_token ${D}`],
    ["a malformed id_token", () => exchange(PROV, META, P, vi.fn(async () => Response.json({ id_token: "a.b" })), NOW), `oidc: id_token invalid ${D} check="malformed"`],
    ["an id_token payload that isn't an object", () => exchange(PROV, META, P, issuer({ claims: "x" }), NOW), `oidc: id_token invalid ${D} check="malformed"`],
    ["a wrong iss", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, iss: "https://evil.example" } }), NOW), `oidc: id_token invalid ${D} check="iss"`],
    ["a wrong aud", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, aud: "other" } }), NOW), `oidc: id_token invalid ${D} check="aud"`],
    ["several audiences and no azp", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, aud: ["id", "other"] } }), NOW), `oidc: id_token invalid ${D} check="azp"`],
    ["an expired id_token", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, exp: NOW / 1000 - 1 } }), NOW), `oidc: id_token invalid ${D} check="exp"`],
    ["a wrong nonce", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, nonce: "other" } }), NOW), `oidc: id_token invalid ${D} check="nonce"`],
    ["someone off the allow-list", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, email: "bob@x.com", name: "Bob" } }), NOW), `oidc: person not on the allow-list ${D}`],
    ["an unverified address", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, email_verified: false } }), NOW), `oidc: address needs a verified email ${D}`],
    ["no address", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, email: undefined } }), NOW), `oidc: address needs a verified email ${D}`],
    ["no sender claim", () => exchange({ ...PROV, allow: ["*"] }, META, P, issuer({ claims: { ...GOOD, name: undefined, email: undefined } }), NOW), `oidc: no sender claim in the id_token ${D} claims="name,email"`],
  ])("%s logs one line saying why", async (_, run, line) => {
    await expect(run()).rejects.toBeInstanceOf(AuthError);
    expect(logged()).toEqual([line]);
  });

  test("the token endpoint's error_description and an error that isn't a short code are left out", async () => {
    const answer = (body: unknown) => vi.fn(async () => Response.json(body, { status: 401 }));
    await expect(exchange(PROV, META, P, answer({ error: "invalid_client", error_description: "client-secret is wrong for ann@x.com" }), NOW)).rejects.toBeInstanceOf(AuthError);
    await expect(exchange(PROV, META, P, answer({ error: "bad client\noidc: forged" }), NOW)).rejects.toBeInstanceOf(AuthError);
    expect(logged()).toEqual([`oidc: token request rejected ${D} status=401 error="invalid_client"`, `oidc: token request rejected ${D} status=401`]);
  });

  test("a sign-in that works logs nothing", async () => {
    const f = issuer();
    expect(await exchange(PROV, await discover(PROV, f), P, f, NOW)).toEqual({ sender: "Ann" });
    expect(warn).not.toHaveBeenCalled();
  });

  test("no secret, code, verifier, nonce, address or name ever reaches the log", async () => {
    const claims = [{ ...GOOD, email: "bob@x.com", name: "Bob" }, { ...GOOD, email_verified: false }, { ...GOOD, nonce: "other" }, { ...GOOD, iss: "https://evil.example" }];
    for (const c of claims) await exchange(PROV, META, P, issuer({ claims: c }), NOW).catch(() => {});
    await exchange({ ...PROV, allow: ["*"], senderClaim: ["nickname"] }, META, P, issuer(), NOW).catch(() => {});
    await exchange(PROV, META, P, issuer({ tokenStatus: 400 }), NOW).catch(() => {});
    const all = logged().join("\n");
    expect(logged()).toHaveLength(6);
    for (const s of ["client-secret", "the-code", "the-verifier", "the-nonce", "ann@x.com", "bob@x.com", "Ann", "Bob", "c2ln"]) expect(all).not.toContain(s);
  });
});
