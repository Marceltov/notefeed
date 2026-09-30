import { afterEach, beforeEach, expect, test } from "vitest";
import { authFailed, authWait, clientIp, rateLimit, resetRateLimitsForTests } from "./limits";

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
