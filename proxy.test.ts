import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { IDENTITY_COOKIE, SESSION_COOKIE } from "@/backend";
import { sign } from "@/backend/oauth/tokens";
import { login } from "@/backend/auth";
import { config, proxy } from "./proxy";

beforeEach(() => {
  delete process.env.NOTEFEED_PASSWORD;
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.PUBLIC_URL;
  delete process.env.NOTEFEED_TRUST_PROXY;
});

const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { method: init.method, headers: { host: "localhost:3000", ...init.headers } });
const rewrite = (res: Response) => res.headers.get("x-middleware-rewrite");
const isNext = (res: Response) => res.headers.get("x-middleware-next") === "1";

test("POST /<feed> is rewritten to the notes route", () => {
  expect(rewrite(proxy(req("/backups", { method: "POST" })))).toBe("http://localhost:3000/api/v1/feeds/backups/notes");
});

test("POST /<feed>/: one trailing slash is stripped (skipTrailingSlashRedirect lets it reach the proxy)", () => {
  expect(rewrite(proxy(req("/backups/", { method: "POST" })))).toBe("http://localhost:3000/api/v1/feeds/backups/notes");
});

test("other trailing slashes still get Next's usual 308 to the path without it", () => {
  for (const [p, want] of [
    ["/backups/", "/backups"],
    ["/backups/x/?a=1", "/backups/x?a=1"],
    ["/login/", "/login"],
  ]) {
    const res = proxy(req(p));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`http://localhost:3000${want}`);
  }
  expect(proxy(req("/backups/x/", { method: "POST" })).status).toBe(308);
});

// Method and path decide, never headers: a browser form, fetch(), curl -F and a client package all
// reach the same handler.
test.each<Record<string, string>>([
  {},
  { "next-action": "abc" },
  { "content-type": "multipart/form-data; boundary=x", accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  { "content-type": "multipart/form-data; boundary=x", accept: "*/*" },
  { "content-type": "application/json", accept: "application/json" },
])("POST /<feed> with headers %j is rewritten to the notes route", (headers) => {
  expect(rewrite(proxy(req("/backups", { method: "POST", headers })))).toBe("http://localhost:3000/api/v1/feeds/backups/notes");
});

test("POST /login goes to the login route, whatever the headers", () => {
  for (const headers of [{}, { "next-action": "abc" }, { accept: "text/html" }] as Record<string, string>[])
    expect(rewrite(proxy(req("/login", { method: "POST", headers })))).toBe("http://localhost:3000/api/login");
  expect(rewrite(proxy(req("/login/", { method: "POST" })))).toBe("http://localhost:3000/api/login");
});

test("POST / (e.g. an empty feed variable) is a JSON 404, not the start page", async () => {
  for (const p of ["/", "/%2e%2e"]) {
    const res = proxy(req(p, { method: "POST" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no feed in URL" });
  }
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(proxy(req("/", { method: "POST" })).status).toBe(404);
});

test.each(["/a/b", "/backups//x"])("POST %s (not one segment) is not rewritten", (p) => {
  expect(rewrite(proxy(req(p, { method: "POST" })))).toBeNull();
});

test("GET /<feed> is not rewritten", () => {
  const res = proxy(req("/backups"));
  expect(rewrite(res)).toBeNull();
  expect(isNext(res)).toBe(true);
});

test("encoded traversal: %2e%2e normalizes to / (not rewritten); a%2Fb stays encoded for the handler to reject", () => {
  expect(rewrite(proxy(req("/%2e%2e", { method: "POST" })))).toBeNull();
  const target = rewrite(proxy(req("/a%2Fb", { method: "POST" })))!;
  expect(target).toBe("http://localhost:3000/api/v1/feeds/a%2Fb/notes");
  // Next decodes the [feed] param; the handler rejects "a/b" (see backend/http/notes.test.ts).
  expect(decodeURIComponent(new URL(target).pathname.split("/")[4])).toBe("a/b");
});

test("locked: pages without a session redirect to the absolute public /login", () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  const res = proxy(req("/backups"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fbackups");
});

test("locked: the redirect keeps the query in next, and / needs none", () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(proxy(req("/backups/x?a=1")).headers.get("location")).toBe("http://localhost:3000/login?next=%2Fbackups%2Fx%3Fa%3D1");
  expect(proxy(req("/")).headers.get("location")).toBe("http://localhost:3000/login");
});

test("locked: a valid session cookie passes", () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(isNext(proxy(req("/backups", { headers: { cookie: `${SESSION_COOKIE}=${login("pw", "test")}` } })))).toBe(true);
});

test("identity on: an identity cookie passes the lock; a forged one, or one when identity is off, does not", () => {
  vi.stubEnv("NOTEFEED_SECRET", "a".repeat(40));
  for (const [k, v] of Object.entries({ ISSUER: "https://idp.example", CLIENT_ID: "id", CLIENT_SECRET: "s", ALLOW: "*" })) vi.stubEnv(`NOTEFEED_OIDC_${k}`, v);
  const cookie = `${IDENTITY_COOKIE}=${sign("identity", { sender: "Ann" })}`;
  expect(isNext(proxy(req("/backups", { headers: { cookie } })))).toBe(true);
  expect(isNext(proxy(req("/backups", { headers: { cookie: `${IDENTITY_COOKIE}=x.y` } })))).toBe(false);
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "");
  vi.stubEnv("NOTEFEED_PASSWORD", "pw");
  const signed = `${IDENTITY_COOKIE}=${sign("identity", { sender: "Ann" })}`;
  expect(isNext(proxy(req("/backups", { headers: { cookie: signed } })))).toBe(false);
});

test("locked: POST /login is rewritten without a session (that's how you get one)", () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(rewrite(proxy(req("/login", { method: "POST" })))).toBe("http://localhost:3000/api/login");
});

test.each(["/r/x/feed.xml", "/login", "/_next/static/x.js", "/api/v1/feeds/backups/notes", "/api/login"])("locked: %s passes", (p) => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(isNext(proxy(req(p)))).toBe(true);
});

test.each(["/mcp", "/metrics", "/oauth/authorize?x=1", "/oauth/token", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource/mcp"])("locked: %s is not sent to /login", (p) => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(isNext(proxy(req(p)))).toBe(true);
});

const OIDC = { NOTEFEED_SECRET: "a".repeat(40), NOTEFEED_OIDC_ISSUER: "https://idp.example", NOTEFEED_OIDC_CLIENT_ID: "id", NOTEFEED_OIDC_CLIENT_SECRET: "s", NOTEFEED_OIDC_ALLOW: "*" };

test.each(["password", "identity-only"])("locked (%s): /privacy and /imprint pass without a session, other pages still redirect", (mode) => {
  if (mode === "password") process.env.NOTEFEED_PASSWORD = "pw";
  else for (const [k, v] of Object.entries(OIDC)) vi.stubEnv(k, v);
  for (const p of ["/privacy", "/imprint"]) {
    const res = proxy(req(p));
    expect(isNext(res)).toBe(true);
    expect(res.status).toBe(200);
  }
  expect(proxy(req("/privacy/")).status).toBe(308); // slash strip still runs before the lock check
  expect(proxy(req("/")).headers.get("location")).toBe("http://localhost:3000/login");
  expect(proxy(req("/privacy/x")).status).toBe(307);
});

test("POST /mcp is not rewritten and passes (open instance)", () => {
  const res = proxy(req("/mcp", { method: "POST" }));
  expect(rewrite(res)).toBeNull();
  expect(isNext(res)).toBe(true);
});

test("POST /mcp is not rewritten and passes (locked instance)", () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  const res = proxy(req("/mcp", { method: "POST" }));
  expect(rewrite(res)).toBeNull();
  expect(isNext(res)).toBe(true);
});

test("POST /metrics is not rewritten to a feed's notes", () => {
  const res = proxy(req("/metrics", { method: "POST" }));
  expect(rewrite(res)).toBeNull();
  expect(isNext(res)).toBe(true);
});

test("locked: POST /<feed> is still rewritten (the handler checks the bearer)", () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(rewrite(proxy(req("/backups", { method: "POST" })))).toBe("http://localhost:3000/api/v1/feeds/backups/notes");
});

test("matcher skips /r/ and /_next/", () => {
  const re = new RegExp(`^${config.matcher}$`);
  for (const p of ["/r/x/feed.xml", "/_next/static/x.js", "/favicon.ico"]) expect(re.test(p)).toBe(false);
  for (const p of ["/", "/backups", "/login", "/rabbit"]) expect(re.test(p)).toBe(true);
});

// Next's proxy runtime rejects a relative Location ("Invalid URL" → 500), so it must be absolute
// and point at the public address, not the internal one.
test("redirects to the public /login behind a reverse proxy", () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  process.env.NOTEFEED_TRUST_PROXY = "1";
  const res = proxy(
    new NextRequest("http://internal:3000/n/x", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "notes.example" },
    }),
  );
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("https://notes.example/login?next=%2Fn%2Fx");
});

test("PUBLIC_URL wins for the redirect", () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  process.env.PUBLIC_URL = "https://notefeed.example.com";
  const res = proxy(new NextRequest("http://internal:3000/", { headers: { host: "internal:3000" } }));
  expect(res.headers.get("location")).toBe("https://notefeed.example.com/login");
});

test("POST /logout (a real POST route) is not rewritten", () => {
  const res = proxy(req("/logout", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }));
  expect(rewrite(res)).toBeNull();
  expect(isNext(res)).toBe(true);
});

test.each(["api", "health", "r"])("POST /%s (reserved) goes to the handler, which answers 400", (name) => {
  expect(rewrite(proxy(req(`/${name}`, { method: "POST" })))).toBe(`http://localhost:3000/api/v1/feeds/${name}/notes`);
});
