import { beforeEach, expect, test } from "vitest";
import { bearerOk, sessionOk, sessionValue, tokenMatches } from "./auth";

beforeEach(() => {
  process.env.NOTEFEED_TOKEN = "s3cret";
});

test("bearerOk accepts only the exact token", () => {
  expect(bearerOk("Bearer s3cret")).toBe(true);
  for (const h of ["Bearer wrong", "Bearer s3cret2", "s3cret", null, "Bearer "]) expect(bearerOk(h)).toBe(false);
});

test("tokenMatches is case-sensitive", () => {
  expect(tokenMatches("s3cret")).toBe(true);
  expect(tokenMatches("S3cret")).toBe(false);
});

test("session value is not the token and verifies only for the current token", () => {
  const v = sessionValue();
  expect(v).not.toContain("s3cret");
  expect(sessionOk(v)).toBe(true);
  expect(sessionOk(undefined)).toBe(false);
  process.env.NOTEFEED_TOKEN = "other";
  expect(sessionOk(v)).toBe(false);
});

test("never authorizes against an empty secret", () => {
  delete process.env.NOTEFEED_TOKEN;
  expect(bearerOk("Bearer ")).toBe(false);
  expect(tokenMatches("")).toBe(false);
  expect(sessionOk(sessionValue())).toBe(false);
});
