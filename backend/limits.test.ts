import { afterEach, beforeEach, expect, test } from "vitest";
import { authAttempt, authFailed, authWait, capReached, clientIp, rateLimit, resetRateLimitsForTests } from "./limits";
import { logsOf } from "./log";

beforeEach(() => {
  resetRateLimitsForTests();
  process.env.NOTEFEED_RATE_LIMIT = "3";
  delete process.env.NOTEFEED_TRUST_PROXY;
});
afterEach(() => {
  delete process.env.NOTEFEED_RATE_LIMIT;
  delete process.env.NOTEFEED_TRUST_PROXY;
});

test("4th call in a minute is limited with 1..60 seconds; allowed again after the window", () => {
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) expect(rateLimit("a", t)).toBeNull();
  const wait = rateLimit("a", t + 1000);
  expect(wait).toBeGreaterThanOrEqual(1);
  expect(wait).toBeLessThanOrEqual(60);
  expect(rateLimit("a", t + 60_000)).toBeNull();
});

test("separate IPs have separate buckets", () => {
  for (let i = 0; i < 3; i++) rateLimit("a", 1);
  expect(rateLimit("a", 1)).not.toBeNull();
  expect(rateLimit("b", 1)).toBeNull();
});

test("NOTEFEED_RATE_LIMIT=0 never limits", () => {
  process.env.NOTEFEED_RATE_LIMIT = "0";
  for (let i = 0; i < 500; i++) expect(rateLimit("a", 1)).toBeNull();
});

test("default is 60 per minute", () => {
  delete process.env.NOTEFEED_RATE_LIMIT;
  for (let i = 0; i < 60; i++) expect(rateLimit("a", 1)).toBeNull();
  expect(rateLimit("a", 1)).not.toBeNull();
});

test("clientIp trusts x-forwarded-for only with NOTEFEED_TRUST_PROXY=1, and takes the last entry", () => {
  // The client sent 6.6.6.6; an appending proxy added the address it saw, 1.2.3.4.
  const h = new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" });
  expect(clientIp(h)).toBe("direct");
  process.env.NOTEFEED_TRUST_PROXY = "1";
  expect(clientIp(h)).toBe("1.2.3.4");
  expect(clientIp(new Headers({ "x-forwarded-for": "5.6.7.8" }))).toBe("5.6.7.8");
  expect(clientIp(new Headers())).toBe("direct");
});

test("failed passwords and posts never share a bucket, whatever the IP string", () => {
  for (let i = 0; i < 3; i++) authFailed("1.1.1.1", 1);
  expect(authWait("1.1.1.1", 1)).not.toBeNull();
  expect(rateLimit("auth:1.1.1.1", 1)).toBeNull();
});

test("an expired entry doesn't limit, even before the next prune", () => {
  const t = 1_000_000;
  rateLimit("z", t); // prunes at t
  for (let i = 0; i < 3; i++) rateLimit("a", t + 30_000);
  rateLimit("z", t + 60_000); // prunes again; a is still live
  expect(rateLimit("a", t + 89_000)).not.toBeNull();
  expect(rateLimit("a", t + 95_000)).toBeNull(); // a expired at t + 90_000, next prune only at t + 120_000
});

test("authAttempt counts before the check and gives the attempt back when it succeeded", () => {
  const t = 1_000_000;
  const held = [authAttempt("a", t), authAttempt("a", t), authAttempt("a", t)];
  expect(authAttempt("a", t)).toBeGreaterThanOrEqual(1); // three checks still running: the limit holds
  expect(authWait("a", t)).not.toBeNull();
  for (const back of held) (back as () => void)();
  expect(authWait("a", t)).toBeNull();
  for (let i = 0; i < 3; i++) expect(authAttempt("a", t)).toBeTypeOf("function"); // kept: these were wrong
  expect(authAttempt("a", t)).toBeTypeOf("number");
});

test("giving an attempt back never goes below zero, and never touches a later window", () => {
  const t = 1_000_000;
  const back = authAttempt("a", t) as () => void;
  back();
  back();
  for (let i = 0; i < 3; i++) authFailed("a", t);
  expect(authWait("a", t)).not.toBeNull(); // a count below zero would have left room for a fourth

  const old = authAttempt("b", t) as () => void;
  for (let i = 0; i < 3; i++) authFailed("b", t + 60_000); // a new window, filled by others
  old();
  expect(authWait("b", t + 60_001)).not.toBeNull();
});

test("with the limit off, authAttempt always allows", () => {
  process.env.NOTEFEED_RATE_LIMIT = "0";
  for (let i = 0; i < 5; i++) (authAttempt("a", 1) as () => void)();
  expect(authAttempt("a", 1)).toBeTypeOf("function");
});

test("a limit reached is a debug line with its kind, never the IP", async () => {
  const logs = await logsOf(() => {
    for (let i = 0; i < 4; i++) rateLimit("203.0.113.9", 0);
    for (let i = 0; i < 3; i++) authFailed("203.0.113.9", 0);
    authWait("203.0.113.9", 0);
  });
  expect(logs).toEqual([
    { level: "debug", component: "limits", msg: "rate limit reached", kind: "post" },
    { level: "debug", component: "limits", msg: "rate limit reached", kind: "password" },
  ]);
});

test("capReached logs a warning with the kind and hands the error on", async () => {
  const e = new Error("x");
  expect(await logsOf(() => expect(capReached("note", e)).toBe(e))).toEqual([{ level: "warn", component: "limits", msg: "cap reached", kind: "note" }]);
});
