import { beforeEach, describe, expect, test, vi } from "vitest";
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

beforeEach(() => resetDiscoveryForTests());

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
    ["an issuer differing only by a slash", { ...META, issuer: `${ISS}/` }],
    ["no token endpoint", { ...META, token_endpoint: undefined }],
    ["an endpoint that isn't a URL", { ...META, authorization_endpoint: "nope" }],
    ["not an object", "x"],
  ])("refuses %s", async (_, doc) => {
    await expect(discover(PROV, issuer({ doc }))).rejects.toBeInstanceOf(AuthError);
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
