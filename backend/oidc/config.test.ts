import { afterEach, beforeEach, expect, test } from "vitest";
import { config } from "../config";
import { allowed, identityOn, senderFrom } from "./config";

const VARS = ["ISSUER", "CLIENT_ID", "CLIENT_SECRET", "ALLOW"].map((n) => `NOTEFEED_OIDC_${n}`);
const ALL = [...VARS, "NOTEFEED_OIDC_SENDER_CLAIM"];
const setAll = () => {
  process.env.NOTEFEED_OIDC_ISSUER = "https://idp.example";
  process.env.NOTEFEED_OIDC_CLIENT_ID = "id";
  process.env.NOTEFEED_OIDC_CLIENT_SECRET = "secret";
  process.env.NOTEFEED_OIDC_ALLOW = "a@x.com";
};
beforeEach(() => ALL.forEach((v) => delete process.env[v]));
afterEach(() => ALL.forEach((v) => delete process.env[v]));

test("identityOn needs all four variables and a non-empty allow-list", () => {
  expect(identityOn()).toBe(false);
  setAll();
  expect(identityOn()).toBe(true);
  for (const v of VARS) {
    setAll();
    process.env[v] = "";
    expect(identityOn()).toBe(false);
  }
  setAll();
  process.env.NOTEFEED_OIDC_ALLOW = " , ";
  expect(identityOn()).toBe(false);
});

test("config.oidc splits, trims and lowercases the allow-list", () => {
  setAll();
  process.env.NOTEFEED_OIDC_ALLOW = " A@X.com, @Y.com ,*";
  expect(config.oidc()).toEqual({ issuer: "https://idp.example", clientId: "id", clientSecret: "secret", allow: ["a@x.com", "@y.com", "*"], senderClaim: ["name", "email"] });
});

const allow = (list: string, claims: { email?: string; email_verified?: boolean }) => {
  process.env.NOTEFEED_OIDC_ALLOW = list;
  return allowed(claims);
};

test("allowed: exact address, case-insensitive, verified only", () => {
  expect(allow("a@x.com", { email: "A@X.com", email_verified: true })).toBe(true);
  expect(allow("a@x.com", { email: "b@x.com", email_verified: true })).toBe(false);
  expect(allow("a@x.com", { email: "a@x.com" })).toBe(false);
  expect(allow("a@x.com", { email: "a@x.com", email_verified: false })).toBe(false);
  expect(allow("a@x.com", {})).toBe(false);
});

test("allowed: @domain matches that domain only", () => {
  const ok = { email_verified: true };
  expect(allow("@x.com", { ...ok, email: "a@x.com" })).toBe(true);
  for (const email of ["a@sub.x.com", "a@x.com.evil", "ax.com"]) expect(allow("@x.com", { ...ok, email })).toBe(false);
  expect(allow("@x.com", { email: "a@x.com" })).toBe(false);
});

test("allowed: * allows anyone, even without an email", () => {
  expect(allow("*", {})).toBe(true);
  expect(allow("*", { email: "a@x.com" })).toBe(true);
});

test("allowed: an empty list allows nobody", () => {
  expect(allow("", { email: "a@x.com", email_verified: true })).toBe(false);
});

const NE = ["name", "email"];

test("senderFrom: default order name then email, trimmed", () => {
  expect(senderFrom({ name: " Ann ", email: "a@x" }, NE)).toBe("Ann");
  expect(senderFrom({ name: "  ", email: "a@x" }, NE)).toBe("a@x");
  expect(senderFrom({ email: "a@x" }, NE)).toBe("a@x");
  expect(senderFrom({}, NE)).toBeUndefined();
});

test("senderFrom: custom order, sub, fall-through past missing and non-string values", () => {
  const c = { preferred_username: "ann", name: "Ann", email: "a@x", sub: "u-1", n: 5, o: {} };
  expect(senderFrom(c, ["preferred_username", "email"])).toBe("ann");
  expect(senderFrom(c, ["sub"])).toBe("u-1");
  expect(senderFrom(c, ["missing", "n", "o", "email"])).toBe("a@x");
  expect(senderFrom(c, ["n", "o", "missing"])).toBeUndefined();
  expect(senderFrom({ Name: "x" }, ["name"])).toBeUndefined();
});

test("config.oidc senderClaim: trimmed, empties ignored, case kept, unset or empty means name,email", () => {
  const claim = (v?: string) => {
    if (v === undefined) delete process.env.NOTEFEED_OIDC_SENDER_CLAIM;
    else process.env.NOTEFEED_OIDC_SENDER_CLAIM = v;
    return config.oidc().senderClaim;
  };
  expect(claim()).toEqual(NE);
  expect(claim("")).toEqual(NE);
  expect(claim(" , ")).toEqual(NE);
  expect(claim(" preferred_username , ,Email ")).toEqual(["preferred_username", "Email"]);
  expect(claim("sub")).toEqual(["sub"]);
});

test("the sender claim is not part of identityOn", () => {
  process.env.NOTEFEED_OIDC_SENDER_CLAIM = "sub";
  expect(identityOn()).toBe(false);
});
