import { afterEach, beforeEach, expect, test } from "vitest";
import { bearerOf, checkBearer, locked, login, sessionOk } from "./auth";
import { AuthError, TooManyAttemptsError } from "./errors";
import { resetRateLimitsForTests } from "./limits";

beforeEach(() => {
  process.env.NOTEFEED_PASSWORD = "s3cret";
  resetRateLimitsForTests();
});
afterEach(() => {
  delete process.env.NOTEFEED_RATE_LIMIT;
});

// The thrown error, or null if the call passed.
const thrown = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return e;
  }
};

test("locked follows NOTEFEED_PASSWORD", () => {
  expect(locked()).toBe(true);
  delete process.env.NOTEFEED_PASSWORD;
  expect(locked()).toBe(false);
});

test("checkBearer accepts only the exact password when locked", () => {
  expect(thrown(() => checkBearer("Bearer s3cret", "ip"))).toBeNull();
  for (const h of ["Bearer wrong", "Bearer s3cret2", "Bearer S3cret", "s3cret", null, "Bearer "])
    expect(thrown(() => checkBearer(h, "ip"))).toBeInstanceOf(AuthError);
});

test("bearerOf", () => {
  expect(bearerOf("Bearer x")).toBe("x");
  expect(bearerOf("bearer x")).toBe("x");
  expect(bearerOf("Bearer  x")).toBe("x");
  for (const h of ["Bearer ", "Bearer", "Basic x", "x", "", null]) expect(bearerOf(h)).toBe("");
});

test("login: after NOTEFEED_RATE_LIMIT failures the IP must wait, even with the right password", () => {
  process.env.NOTEFEED_RATE_LIMIT = "3";
  for (let i = 0; i < 3; i++) expect(thrown(() => login("wrong", "a"))).toBeInstanceOf(AuthError);
  const e = thrown(() => login("s3cret", "a"));
  expect(e).toBeInstanceOf(TooManyAttemptsError);
  expect((e as TooManyAttemptsError).retryAfter).toBeGreaterThanOrEqual(1);
  expect((e as TooManyAttemptsError).retryAfter).toBeLessThanOrEqual(60);
  expect(thrown(() => login("s3cret", "b"))).toBeNull(); // other IPs unaffected
});

test("login: successes are not counted", () => {
  process.env.NOTEFEED_RATE_LIMIT = "3";
  for (let i = 0; i < 5; i++) login("s3cret", "a");
  expect(thrown(() => login("wrong", "a"))).toBeInstanceOf(AuthError);
});

test("the session value is not the password and verifies only for the current password", () => {
  const v = login("s3cret", "ip");
  expect(v).not.toContain("s3cret");
  expect(sessionOk(v)).toBe(true);
  expect(sessionOk(undefined)).toBe(false);
  expect(sessionOk("nope")).toBe(false);
  process.env.NOTEFEED_PASSWORD = "other";
  expect(sessionOk(v)).toBe(false);
});

test("unlocked: bearer and session always pass, login never does and is never counted", () => {
  delete process.env.NOTEFEED_PASSWORD;
  process.env.NOTEFEED_RATE_LIMIT = "1";
  for (let i = 0; i < 3; i++) {
    expect(thrown(() => checkBearer(null, "ip"))).toBeNull();
    expect(thrown(() => checkBearer("Bearer anything", "ip"))).toBeNull();
    expect(thrown(() => login("", "ip"))).toBeInstanceOf(AuthError); // never a TooManyAttemptsError
  }
  expect(sessionOk(undefined)).toBe(true);
});

test("an empty NOTEFEED_PASSWORD counts as unlocked", () => {
  process.env.NOTEFEED_PASSWORD = "";
  expect(locked()).toBe(false);
  expect(thrown(() => login("", "ip"))).toBeInstanceOf(AuthError);
});
