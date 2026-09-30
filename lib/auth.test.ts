import { afterEach, beforeEach, expect, test } from "vitest";
import { bearerAttempt, locked, passwordAttempt, passwordMatches, sessionOk, sessionValue } from "./auth";
import { resetRateLimitsForTests } from "./limits";

beforeEach(() => {
  process.env.NOTEFEED_PASSWORD = "s3cret";
  resetRateLimitsForTests();
});
afterEach(() => {
  delete process.env.NOTEFEED_RATE_LIMIT;
});

test("locked follows NOTEFEED_PASSWORD", () => {
  expect(locked()).toBe(true);
  delete process.env.NOTEFEED_PASSWORD;
  expect(locked()).toBe(false);
});

test("bearerAttempt accepts only the exact password when locked", () => {
  expect(bearerAttempt("Bearer s3cret", "ip")).toBe("ok");
  for (const h of ["Bearer wrong", "Bearer s3cret2", "s3cret", null, "Bearer "]) expect(bearerAttempt(h, "ip")).toBe("wrong");
});

// The login form's decision (loginAction itself needs Next's request scope).
test("passwordAttempt: after NOTEFEED_RATE_LIMIT failures the IP must wait, even with the right password", () => {
  process.env.NOTEFEED_RATE_LIMIT = "3";
  for (let i = 0; i < 3; i++) expect(passwordAttempt("wrong", "a")).toBe("wrong");
  const wait = passwordAttempt("s3cret", "a");
  expect(typeof wait).toBe("number");
  expect(wait).toBeGreaterThanOrEqual(1);
  expect(wait).toBeLessThanOrEqual(60);
  expect(passwordAttempt("s3cret", "b")).toBe("ok"); // other IPs unaffected
});

test("passwordAttempt: successes are not counted", () => {
  process.env.NOTEFEED_RATE_LIMIT = "3";
  for (let i = 0; i < 5; i++) expect(passwordAttempt("s3cret", "a")).toBe("ok");
  expect(passwordAttempt("wrong", "a")).toBe("wrong");
});

test("passwordMatches is case-sensitive", () => {
  expect(passwordMatches("s3cret")).toBe(true);
  expect(passwordMatches("S3cret")).toBe(false);
});

test("session value is not the password and verifies only for the current password", () => {
  const v = sessionValue();
  expect(v).not.toContain("s3cret");
  expect(sessionOk(v)).toBe(true);
  expect(sessionOk(undefined)).toBe(false);
  expect(sessionOk("nope")).toBe(false);
  process.env.NOTEFEED_PASSWORD = "other";
  expect(sessionOk(v)).toBe(false);
});

test("unlocked: everything passes, but no password ever matches", () => {
  delete process.env.NOTEFEED_PASSWORD;
  process.env.NOTEFEED_RATE_LIMIT = "1";
  for (let i = 0; i < 3; i++) {
    expect(bearerAttempt(null, "ip")).toBe("ok");
    expect(bearerAttempt("Bearer anything", "ip")).toBe("ok");
    expect(passwordAttempt("x", "ip")).toBe("wrong"); // never counted, never a wait
  }
  expect(sessionOk(undefined)).toBe(true);
  expect(passwordMatches("x")).toBe(false);
  expect(passwordMatches("")).toBe(false);
});

test("an empty NOTEFEED_PASSWORD counts as unlocked", () => {
  process.env.NOTEFEED_PASSWORD = "";
  expect(locked()).toBe(false);
  expect(passwordMatches("")).toBe(false);
});
