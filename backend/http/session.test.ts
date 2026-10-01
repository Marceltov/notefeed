import { afterEach, beforeEach, expect, test } from "vitest";
import { SESSION_COOKIE, sessionOk } from "../auth";
import { resetRateLimitsForTests } from "../limits";
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
