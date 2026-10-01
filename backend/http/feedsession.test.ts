import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createProtected, protectedFeed } from "../feedlock";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { feedAccessRoute } from "./feedsession";

// Both cookies: the page's path and the feed's API path (the web UI's fetch() goes there).
const cookies = (res: Response) => res.headers.getSetCookie();
const setBoth = (feed: string, flags = "Max-Age=31536000; HttpOnly; SameSite=Lax") => [
  expect.stringMatching(new RegExp(`^nf_feed_${feed}=[0-9a-f]+; Path=/${feed}; ${flags}$`)),
  expect.stringMatching(new RegExp(`^nf_feed_${feed}=[0-9a-f]+; Path=/api/v1/feeds/${feed}; ${flags}$`)),
];
const clearedBoth = (feed: string) => [
  `nf_feed_${feed}=; Path=/${feed}; Max-Age=0; HttpOnly; SameSite=Lax`,
  `nf_feed_${feed}=; Path=/api/v1/feeds/${feed}; Max-Age=0; HttpOnly; SameSite=Lax`,
];

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-fs-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  delete process.env.NOTEFEED_RATE_LIMIT;
  resetFeedsForTests();
  resetRateLimitsForTests();
  await createProtected("lockd", "pw");
});
afterEach(() => {
  delete process.env.NOTEFEED_RATE_LIMIT;
  delete process.env.PUBLIC_URL;
});

const post = (feed: string, fields: Record<string, string>, origin: string | null = "http://localhost:3000") =>
  feedAccessRoute(
    new Request(`http://localhost:3000/${feed}/access`, {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "content-type": "application/x-www-form-urlencoded",
        ...(origin ? { origin } : {}),
      },
      body: new URLSearchParams(fields),
    }),
    feed,
  );

test("the right password sets the feed cookie and goes to the feed", async () => {
  const res = await post("lockd", { action: "unlock", password: "pw" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/lockd");
  expect(cookies(res)).toEqual(setBoth("lockd"));
});

test("the cookie is Secure when the public URL is https", async () => {
  process.env.PUBLIC_URL = "https://notes.example";
  const res = await post("lockd", { action: "unlock", password: "pw" }, "https://notes.example");
  expect(cookies(res)).toEqual(setBoth("lockd", "Max-Age=31536000; HttpOnly; SameSite=Lax; Secure"));
});

test("a wrong password goes back with the error; no cookie", async () => {
  const res = await post("lockd", { action: "unlock", password: "nope" });
  expect(res.headers.get("location")).toBe("/lockd?error=auth");
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("over the limit: the wait, even for the right password", async () => {
  process.env.NOTEFEED_RATE_LIMIT = "2";
  for (let i = 0; i < 2; i++) await post("lockd", { action: "unlock", password: "nope" });
  expect((await post("lockd", { action: "unlock", password: "pw" })).headers.get("location")).toMatch(
    /^\/lockd\?error=too_many_attempts&retry=\d+$/,
  );
});

test("unlock on an open feed just goes to the feed", async () => {
  const res = await post("openfeed", { action: "unlock", password: "x" });
  expect(res.headers.get("location")).toBe("/openfeed");
  expect(res.headers.get("set-cookie")).toBeNull();
});

test.each([["another site", "https://evil.example"], ["no Origin", null]])("unlock from %s is refused before the password is looked at", async (_, origin) => {
  process.env.NOTEFEED_RATE_LIMIT = "1";
  for (const password of ["pw", "nope", "nope"]) {
    const res = await post("lockd", { action: "unlock", password }, origin);
    expect(res.headers.get("location")).toBe("/lockd?error=auth");
    expect(res.headers.get("set-cookie")).toBeNull();
  }
  // Nothing was counted: the owner's own attempt still goes through.
  expect(cookies(await post("lockd", { action: "unlock", password: "pw" }))).toEqual(setBoth("lockd"));
});

test("change from another site is refused and changes nothing", async () => {
  const res = await post("lockd", { action: "change", current: "pw", next: "new" }, "https://evil.example");
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/lockd?error=auth");
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(cookies(await post("lockd", { action: "unlock", password: "pw" }))).toHaveLength(2);
});

test("change with the right current password sets a cookie for the new one", async () => {
  const res = await post("lockd", { action: "change", current: "pw", next: "new" });
  expect(res.headers.get("location")).toBe("/lockd");
  expect(cookies(res)).toEqual(setBoth("lockd"));
  expect((await post("lockd", { action: "unlock", password: "pw" })).headers.get("location")).toBe("/lockd?error=auth");
  expect((await post("lockd", { action: "unlock", password: "new" })).headers.get("location")).toBe("/lockd");
});

test("change with a wrong current password or a bad new one goes back with the error", async () => {
  expect((await post("lockd", { action: "change", current: "x", next: "new" })).headers.get("location")).toBe("/lockd?error=auth");
  expect((await post("lockd", { action: "change", current: "pw", next: "" })).headers.get("location")).toBe("/lockd?error=invalid_body");
});

test("remove with the right current password opens the feed and clears the cookie", async () => {
  const res = await post("lockd", { action: "remove", current: "pw" });
  expect(res.headers.get("location")).toBe("/lockd");
  expect(cookies(res)).toEqual(clearedBoth("lockd"));
  expect(await protectedFeed("lockd")).toBe(false);
});

test("lock clears the cookie", async () => {
  const res = await post("lockd", { action: "lock" });
  expect(res.headers.get("location")).toBe("/lockd");
  expect(cookies(res)).toEqual(clearedBoth("lockd"));
});

test("invalid and reserved feed names, and unknown actions", async () => {
  expect((await post("a%2Fb", { action: "unlock", password: "x" })).status).toBe(400);
  expect((await post("login", { action: "unlock", password: "x" })).status).toBe(400);
  expect((await post("lockd", { action: "bogus" })).status).toBe(400);
});
