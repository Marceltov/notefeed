import { afterEach, beforeEach, expect, test } from "vitest";
import { clientIp, rateLimit, resetRateLimitsForTests } from "./limits";

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

test("clientIp trusts x-forwarded-for only with NOTEFEED_TRUST_PROXY=1", () => {
  const h = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
  expect(clientIp(h)).toBe("direct");
  process.env.NOTEFEED_TRUST_PROXY = "1";
  expect(clientIp(h)).toBe("1.2.3.4");
  expect(clientIp(new Headers())).toBe("direct");
});
