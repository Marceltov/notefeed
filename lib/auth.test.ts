import { beforeEach, expect, test } from "vitest";
import { bearerOk, locked, passwordMatches, sessionOk, sessionValue } from "./auth";

beforeEach(() => {
  process.env.NOTEFEED_PASSWORD = "s3cret";
});

test("locked follows NOTEFEED_PASSWORD", () => {
  expect(locked()).toBe(true);
  delete process.env.NOTEFEED_PASSWORD;
  expect(locked()).toBe(false);
});

test("bearerOk accepts only the exact password when locked", () => {
  expect(bearerOk("Bearer s3cret")).toBe(true);
  for (const h of ["Bearer wrong", "Bearer s3cret2", "s3cret", null, "Bearer "]) expect(bearerOk(h)).toBe(false);
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
  expect(bearerOk(null)).toBe(true);
  expect(bearerOk("Bearer anything")).toBe(true);
  expect(sessionOk(undefined)).toBe(true);
  expect(passwordMatches("x")).toBe(false);
  expect(passwordMatches("")).toBe(false);
});

test("an empty NOTEFEED_PASSWORD counts as unlocked", () => {
  process.env.NOTEFEED_PASSWORD = "";
  expect(locked()).toBe(false);
  expect(passwordMatches("")).toBe(false);
});
