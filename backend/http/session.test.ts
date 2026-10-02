import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AuthError } from "../errors";
import { IDENTITY_COOKIE, SESSION_COOKIE, sessionOk } from "../auth";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { sign } from "../oauth/tokens";
import { authorize, sender } from "./request";
import { loginRoute, logoutRoute } from "./session";

beforeEach(() => {
  process.env.NOTEFEED_PASSWORD = "pw";
  resetRateLimitsForTests();
});
afterEach(() => {
  delete process.env.NOTEFEED_RATE_LIMIT;
  delete process.env.PUBLIC_URL;
});

// What the login page's plain form sends.
const login = (fields: Record<string, string>) =>
  loginRoute(
    new Request("http://localhost:3000/login", {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    }),
  );
const sessionFrom = (res: Response) => /nf_session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

test("the right password sets the session cookie and returns to next", async () => {
  const res = await login({ password: "pw", next: "/backups?x=1" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/backups?x=1");
  expect(sessionOk(sessionFrom(res))).toBe(true);
  expect(res.headers.get("set-cookie")).toMatch(/; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax$/);
});

test("the cookie is Secure when the public URL is https", async () => {
  process.env.PUBLIC_URL = "https://notes.example";
  expect((await login({ password: "pw" })).headers.get("set-cookie")).toMatch(/; Secure$/);
});

test.each([undefined, "//evil.example", "https://evil.example", "/\\evil.example"])("next=%j lands on /", async (next) => {
  const res = await login(next === undefined ? { password: "pw" } : { password: "pw", next });
  expect(res.headers.get("location")).toBe("/");
});

test("a wrong password goes back to the login page with the error, keeping next; no cookie", async () => {
  const res = await login({ password: "nope", next: "/backups" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/login?error=auth&next=%2Fbackups");
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("too many wrong passwords: the wait, even for the right one", async () => {
  process.env.NOTEFEED_RATE_LIMIT = "2";
  for (let i = 0; i < 2; i++) await login({ password: "nope" });
  expect((await login({ password: "pw" })).headers.get("location")).toMatch(/^\/login\?error=too_many_attempts&retry=\d+&next=%2F$/);
});

test("an oversized body is a failed login, not a crash", async () => {
  const res = await login({ password: "x".repeat(10_000) });
  expect(res.headers.get("location")).toBe("/login?error=auth&next=%2F");
});

test("logout clears the cookie and goes to the login page (/ when open)", () => {
  const res = logoutRoute();
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/login");
  expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=; Path=/; Max-Age=0`));
  delete process.env.NOTEFEED_PASSWORD;
  expect(logoutRoute().headers.get("location")).toBe("/");
});

test("logout clears the identity cookie too; with sign-in alone it goes to the login page", () => {
  const cleared = (res: Response) => res.headers.getSetCookie().map((c) => c.split("=")[0]);
  expect(cleared(logoutRoute())).toEqual([SESSION_COOKIE, IDENTITY_COOKIE]);
  expect(logoutRoute().headers.getSetCookie()[1]).toMatch(new RegExp(`^${IDENTITY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax$`));
  process.env.NOTEFEED_PASSWORD = "";
  vi.stubEnv("NOTEFEED_OIDC_ISSUER", "https://idp.example");
  vi.stubEnv("NOTEFEED_OIDC_CLIENT_ID", "id");
  vi.stubEnv("NOTEFEED_OIDC_CLIENT_SECRET", "secret");
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "*");
  try {
    expect(logoutRoute().headers.get("location")).toBe("/login");
  } finally {
    vi.unstubAllEnvs();
  }
});

describe("identity session", () => {
  const SAME = { host: "localhost:3000", origin: "http://localhost:3000" };
  const id = () => `${IDENTITY_COOKIE}=${sign("identity", { sender: "Ann" })}`;
  const ok = (h: Record<string, string>) => {
    try {
      authorize(new Headers(h), "ip");
      return true;
    } catch (e) {
      if (e instanceof AuthError) return false;
      throw e;
    }
  };
  beforeEach(() => {
    delete process.env.NOTEFEED_PASSWORD;
    vi.stubEnv("NOTEFEED_SECRET", "a".repeat(40));
    vi.stubEnv("NOTEFEED_OIDC_ISSUER", "https://idp.example");
    vi.stubEnv("NOTEFEED_OIDC_CLIENT_ID", "id");
    vi.stubEnv("NOTEFEED_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("NOTEFEED_OIDC_ALLOW", "*");
    resetFeedsForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetFeedsForTests();
  });

  test("a same-origin identity cookie authorizes and names the sender", () => {
    expect(ok({ ...SAME, cookie: id() })).toBe(true);
    expect(sender(new Headers({ ...SAME, cookie: id() }))).toBe("Ann");
  });

  test("cross-origin, or with an Authorization header, the cookie counts for nothing", () => {
    const cross = { host: "localhost:3000", origin: "https://evil.example", cookie: id() };
    expect(ok(cross)).toBe(false);
    expect(sender(new Headers(cross))).toBeUndefined();
    expect(sender(new Headers({ host: "localhost:3000", cookie: id() }))).toBeUndefined(); // no Origin
    const withAuth = { ...SAME, cookie: id(), authorization: "Bearer x" };
    expect(ok(withAuth)).toBe(false);
    expect(sender(new Headers(withAuth))).toBeUndefined();
  });

  test("a tampered, expired or wrong-kind cookie is refused", () => {
    const t = sign("identity", { sender: "Ann" });
    for (const bad of [t.slice(0, -2) + (t.endsWith("AA") ? "BB" : "AA"), sign("identity", { sender: "Ann" }, Date.now() - 8 * 86400_000), sign("access", { aud: "x", sender: "Ann" })]) {
      expect(ok({ ...SAME, cookie: `${IDENTITY_COOKIE}=${bad}` })).toBe(false);
      expect(sender(new Headers({ ...SAME, cookie: `${IDENTITY_COOKIE}=${bad}` }))).toBeUndefined();
    }
  });

  test("an access bearer gives its sender; an expired one, a refresh token or the password bearer none", () => {
    const bearer = (t: string) => new Headers({ host: "localhost:3000", authorization: `Bearer ${t}` });
    expect(sender(bearer(sign("access", { aud: "http://localhost:3000/mcp", sender: "Ann" })))).toBe("Ann");
    expect(sender(bearer(sign("access", { aud: "http://localhost:3000/mcp", sender: "Ann" }, Date.now() - 3601_000)))).toBeUndefined();
    expect(sender(bearer(sign("refresh", { cid: "c", aud: "a", jti: "j", sender: "Ann" })))).toBeUndefined();
    vi.stubEnv("NOTEFEED_PASSWORD", "pw");
    expect(sender(bearer("pw"))).toBeUndefined();
  });

  test("identity off: a validly signed cookie neither authorizes nor names a sender", () => {
    vi.stubEnv("NOTEFEED_PASSWORD", "pw");
    const cookie = id(); // signed under the same key the instance has once identity is off
    vi.stubEnv("NOTEFEED_OIDC_ALLOW", "");
    expect(ok({ ...SAME, cookie })).toBe(false);
    expect(sender(new Headers({ ...SAME, cookie }))).toBeUndefined();
    expect(sessionOk(undefined, cookie.split("=")[1])).toBe(false);
    vi.stubEnv("NOTEFEED_PASSWORD", "");
    expect(sender(new Headers({ ...SAME, cookie: id() }))).toBeUndefined(); // open instance
    expect(sender(new Headers({ host: "localhost:3000", authorization: `Bearer ${sign("access", { aud: "a", sender: "Ann" })}` }))).toBeUndefined();
  });
});
