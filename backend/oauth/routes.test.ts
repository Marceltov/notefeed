import { createHash, randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { mcpRoute } from "../mcp";
import { authServerRoute, authorizeRoute, checkAuthorize, metadataPreflight, protectedResourceRoute, registerPreflight, registerRoute, tokenRoute } from "./routes";
import { cid, newJti, resetTokensForTests, sign, verify } from "./tokens";

const BASE = "http://localhost:3000";
const RESOURCE = `${BASE}/mcp`;
const CB = "https://claude.ai/api/mcp/auth_callback";
const H = { host: "localhost:3000" };

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-oauth-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  process.env.NOTEFEED_PASSWORD = "pw";
  resetFeedsForTests();
  resetRateLimitsForTests();
  resetTokensForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL"]) delete process.env[k];
});

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

const post = (path: string, body: BodyInit, type: string) =>
  new Request(BASE + path, { method: "POST", headers: { ...H, "content-type": type }, body });
const register = (body: unknown) => registerRoute(post("/oauth/register", JSON.stringify(body), "application/json"));
const form = (path: string, fields: Record<string, string>) => post(path, new URLSearchParams(fields), "application/x-www-form-urlencoded");
const token = (fields: Record<string, string>) => tokenRoute(form("/oauth/token", fields));

async function clientId(redirect_uris = [CB]) {
  const res = await register({ client_name: "Claude", redirect_uris });
  expect(res.status).toBe(201);
  return (await res.json()).client_id as string;
}

function authParams(client_id: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({ response_type: "code", client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: "S256", state: "a b&c", resource: RESOURCE, ...extra });
}

// Registers, logs in and returns the code with what the token request needs.
async function code() {
  const id = await clientId();
  const { verifier, challenge } = pkce();
  const res = await authorizeRoute(form("/api/oauth/authorize", { ...Object.fromEntries(authParams(id, challenge)), password: "pw" }));
  expect(res.status).toBe(303);
  const loc = new URL(res.headers.get("location")!);
  return { id, verifier, code: loc.searchParams.get("code")!, loc };
}
const exchange = (c: { id: string; verifier: string; code: string }, extra: Record<string, string> = {}) =>
  token({ grant_type: "authorization_code", code: c.code, client_id: c.id, redirect_uri: CB, code_verifier: c.verifier, resource: RESOURCE, ...extra });

const callMcp = (bearer: string) =>
  mcpRoute(
    new Request(RESOURCE, {
      method: "POST",
      headers: { ...H, authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "post_note" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "post_note",
          arguments: { feed: "a", markdown: "# Hi" },
          _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "t", version: "0" }, "io.modelcontextprotocol/clientCapabilities": {} },
        },
      }),
    }),
  );

describe("flow", () => {
  test("register, authorize, log in, exchange, call /mcp", async () => {
    const id = await clientId();
    const { challenge } = pkce();
    expect(checkAuthorize(authParams(id, challenge), new Headers(H))).toMatchObject({ kind: "page", clientName: "Claude", redirectHost: "claude.ai" });

    const c = await code();
    expect(`${c.loc.origin}${c.loc.pathname}`).toBe(CB);
    expect(c.loc.search).toMatch(/^\?code=[^&]+&state=a\+b%26c&iss=http%3A%2F%2Flocalhost%3A3000$/);
    expect(c.loc.searchParams.get("state")).toBe("a b&c");

    const res = await exchange(c);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(Object.keys(body).sort()).toEqual(["access_token", "expires_in", "refresh_token", "token_type"]);

    const mcp = await callMcp(body.access_token);
    expect(mcp.status).toBe(200);
    expect((await mcp.json()).result.isError).toBeUndefined();
  });

  test("refresh rotates; the old refresh token is spent", async () => {
    const c = await code();
    const first = await (await exchange(c)).json();
    const res = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: c.id });
    expect(res.status).toBe(200);
    const second = await res.json();
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await callMcp(second.access_token)).status).toBe(200);
    const again = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: c.id });
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "invalid_grant" });
  });

  test("a code's sender is carried into the access token and through refresh", async () => {
    const id = await clientId();
    const { verifier, challenge } = pkce();
    const c = sign("code", { cid: cid(id), redirect_uri: CB, code_challenge: challenge, resource: RESOURCE, jti: newJti(), sender: "Ann" });
    const first = await (await exchange({ id, verifier, code: c })).json();
    expect(verify("access", first.access_token)?.sender).toBe("Ann");
    expect(verify("refresh", first.refresh_token)?.sender).toBe("Ann");
    const second = await (await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: id })).json();
    expect(verify("access", second.access_token)?.sender).toBe("Ann");
    expect(verify("refresh", second.refresh_token)?.sender).toBe("Ann");
  });

  test("a password login's tokens have no sender", async () => {
    const { access_token } = await (await exchange(await code())).json();
    expect(verify("access", access_token)).not.toHaveProperty("sender");
  });

  test("a refresh token is bound to its client", async () => {
    const c = await code();
    const { refresh_token } = await (await exchange(c)).json();
    const other = await clientId(["https://other.example/cb"]);
    expect((await (await token({ grant_type: "refresh_token", refresh_token, client_id: other })).json()).error).toBe("invalid_grant");
  });
});

describe("token refusals", () => {
  test("wrong code_verifier", async () => {
    const c = await code();
    const res = await exchange({ ...c, verifier: pkce().verifier });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
    expect((await exchange(c)).status).toBe(200); // a failed attempt doesn't spend the code
  });
  test("code reused", async () => {
    const c = await code();
    expect((await exchange(c)).status).toBe(200);
    expect((await (await exchange(c)).json()).error).toBe("invalid_grant");
  });
  test("code after 301 s", async () => {
    const c = await code();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301_000);
    expect((await (await exchange(c)).json()).error).toBe("invalid_grant");
  });
  test("redirect_uri differing from the code's", async () => {
    const c = await code();
    expect((await (await exchange(c, { redirect_uri: `${CB}/` })).json()).error).toBe("invalid_grant");
  });
  test("another resource", async () => {
    const c = await code();
    expect((await (await exchange(c, { resource: "http://localhost:3000/other" })).json()).error).toBe("invalid_grant");
  });
  test("another client's id", async () => {
    const c = await code();
    expect((await (await exchange({ ...c, id: await clientId(["https://other.example/cb"]) })).json()).error).toBe("invalid_grant");
  });
  test("a forged client_id is invalid_client", async () => {
    const c = await code();
    expect((await (await exchange({ ...c, id: "x.y" })).json()).error).toBe("invalid_client");
  });
  test("missing parameters, unknown grant", async () => {
    expect((await (await token({ grant_type: "authorization_code" })).json()).error).toBe("invalid_request");
    expect((await (await token({ grant_type: "password" })).json()).error).toBe("unsupported_grant_type");
  });
});

describe("checkAuthorize", () => {
  test.each([
    ["a tampered client_id", (p: URLSearchParams) => p.set("client_id", p.get("client_id")!.replace(/.$/, (c) => (c === "A" ? "B" : "A")))],
    ["a redirect_uri with a trailing slash", (p: URLSearchParams) => p.set("redirect_uri", `${CB}/`)],
    ["a duplicated redirect_uri", (p: URLSearchParams) => p.append("redirect_uri", CB)],
  ])("%s: an error, never a redirect", async (_, change) => {
    const p = authParams(await clientId(), pkce().challenge);
    change(p);
    expect(checkAuthorize(p, new Headers(H)).kind).toBe("error");
  });

  test.each([
    ["code_challenge", "invalid_request"],
    ["code_challenge_method", "invalid_request"],
    ["response_type", "unsupported_response_type"],
  ])("missing %s redirects with %s, state and iss", async (name, error) => {
    const p = authParams(await clientId(), pkce().challenge);
    p.delete(name);
    const r = checkAuthorize(p, new Headers(H));
    expect(r.kind).toBe("redirect");
    const loc = new URL((r as { location: string }).location);
    expect(`${loc.origin}${loc.pathname}`).toBe(CB);
    expect(Object.fromEntries(loc.searchParams)).toEqual({ error, state: "a b&c", iss: BASE });
  });

  test("plain PKCE and a foreign resource redirect with an error", async () => {
    const id = await clientId();
    expect(checkAuthorize(authParams(id, pkce().challenge, { code_challenge_method: "plain" }), new Headers(H)).kind).toBe("redirect");
    const r = checkAuthorize(authParams(id, pkce().challenge, { resource: "https://evil.example/mcp" }), new Headers(H));
    expect(new URL((r as { location: string }).location).searchParams.get("error")).toBe("invalid_target");
  });

  test("fields carry only the OAuth parameters", async () => {
    const r = checkAuthorize(authParams(await clientId(), pkce().challenge, { password: "x", scope: "all" }), new Headers(H));
    expect(Object.keys((r as { fields: Record<string, string> }).fields).sort()).toEqual(["client_id", "code_challenge", "code_challenge_method", "redirect_uri", "resource", "response_type", "state"]);
  });
});

describe("register", () => {
  test.each([
    ["no redirect_uris", { redirect_uris: [] }],
    ["http on a public host", { redirect_uris: ["http://example.com/cb"] }],
    ["a fragment", { redirect_uris: ["https://x/cb#f"] }],
    ["six URIs", { redirect_uris: Array.from({ length: 6 }, (_, i) => `https://x/${i}`) }],
    ["a long URI", { redirect_uris: [`https://x/${"a".repeat(503)}`] }],
    ["a long client_name", { client_name: "x".repeat(101), redirect_uris: [CB] }],
    ["a non-string client_name", { client_name: 1, redirect_uris: [CB] }],
    ["a bidi override in client_name", { client_name: "Claude\u202Eevil", redirect_uris: [CB] }],
    ["a control character in client_name", { client_name: "a\nb", redirect_uris: [CB] }],
    ["not an object", [CB]],
  ])("%s: 400", async (_, body) => {
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(["invalid_redirect_uri", "invalid_client_metadata"]).toContain((await res.json()).error);
  });

  test("not JSON: 400", async () => {
    expect((await registerRoute(post("/oauth/register", "{", "application/json"))).status).toBe(400);
  });

  test("loopback http is accepted; extra fields are not signed", async () => {
    const res = await register({ redirect_uris: ["http://127.0.0.1:5555/cb", "http://localhost/cb"], scope: "x", client_secret: "s" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      client_id: body.client_id,
      redirect_uris: ["http://127.0.0.1:5555/cb", "http://localhost/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(Buffer.from(body.client_id.split(".")[0], "base64url").toString()).not.toContain("scope");
  });
});

describe("login", () => {
  test("a wrong password goes back to the page and counts as a failed attempt", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "1";
    const p = authParams(await clientId(), pkce().challenge);
    const res = await authorizeRoute(form("/api/oauth/authorize", { ...Object.fromEntries(p), password: "nope" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/oauth/authorize?${p}&error=auth`);
    const next = await authorizeRoute(form("/api/oauth/authorize", { ...Object.fromEntries(p), password: "pw" }));
    expect(next.headers.get("location")).toMatch(new RegExp(`^/oauth/authorize\\?.*&error=too_many_attempts&retry=\\d+$`));
  });

  test("an invalid client on the POST is a 400, no redirect", async () => {
    const p = authParams(await clientId(), pkce().challenge, { redirect_uri: "https://evil.example/cb" });
    const res = await authorizeRoute(form("/api/oauth/authorize", { ...Object.fromEntries(p), password: "pw" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });
});

test("a changed password invalidates access and refresh tokens", async () => {
  const c = await code();
  const { access_token, refresh_token } = await (await exchange(c)).json();
  process.env.NOTEFEED_PASSWORD = "new";
  expect((await callMcp(access_token)).status).toBe(401);
  expect((await (await token({ grant_type: "refresh_token", refresh_token, client_id: c.id })).json()).error).toBe("invalid_grant");
});

test("open instance: every handler is 404", async () => {
  const id = await clientId();
  delete process.env.NOTEFEED_PASSWORD;
  const get = (path: string) => new Request(BASE + path, { headers: H });
  expect(protectedResourceRoute(get("/.well-known/oauth-protected-resource/mcp")).status).toBe(404);
  expect(authServerRoute(get("/.well-known/oauth-authorization-server")).status).toBe(404);
  expect((await register({ redirect_uris: [CB] })).status).toBe(404);
  expect((await authorizeRoute(form("/api/oauth/authorize", { ...Object.fromEntries(authParams(id, pkce().challenge)), password: "" }))).status).toBe(404);
  expect((await token({ grant_type: "authorization_code" })).status).toBe(404);
  expect(checkAuthorize(authParams(id, pkce().challenge), new Headers(H)).kind).toBe("error");
  expect(metadataPreflight().status).toBe(404);
  expect(registerPreflight().status).toBe(404);
});

describe("CORS for browser-based clients", () => {
  const get = (path: string) => new Request(BASE + path, { headers: H });
  test("metadata, register and token answer with Access-Control-Allow-Origin: *", async () => {
    const c = await code();
    for (const res of [
      protectedResourceRoute(get("/.well-known/oauth-protected-resource/mcp")),
      authServerRoute(get("/.well-known/oauth-authorization-server")),
      await register({ redirect_uris: [CB] }),
      await register({ redirect_uris: [] }),
      await exchange(c),
      await token({ grant_type: "nope" }),
    ])
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
  test("preflights", () => {
    for (const [res, method] of [
      [metadataPreflight(), "GET"],
      [registerPreflight(), "POST"],
    ] as const) {
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toBe(method);
      expect(res.headers.get("access-control-allow-headers")).toBe("content-type, mcp-protocol-version");
    }
  });
});

test("metadata documents", async () => {
  const get = (path: string) => new Request(BASE + path, { headers: H });
  expect(await protectedResourceRoute(get("/.well-known/oauth-protected-resource/mcp")).json()).toEqual({
    resource: RESOURCE,
    authorization_servers: [BASE],
    bearer_methods_supported: ["header"],
  });
  expect(await authServerRoute(get("/.well-known/oauth-authorization-server")).json()).toEqual({
    issuer: BASE,
    authorization_endpoint: `${BASE}/oauth/authorize`,
    token_endpoint: `${BASE}/oauth/token`,
    registration_endpoint: `${BASE}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
  });
});
