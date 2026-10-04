import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { config } from "../config";
import { allowed, identityOn, providerById, providers, senderFrom } from "./config";

const VARS = ["ISSUER", "CLIENT_ID", "CLIENT_SECRET", "ALLOW"].map((n) => `NOTEFEED_OIDC_${n}`);
const setAll = () => {
  process.env.NOTEFEED_OIDC_ISSUER = "https://idp.example";
  process.env.NOTEFEED_OIDC_CLIENT_ID = "id";
  process.env.NOTEFEED_OIDC_CLIENT_SECRET = "secret";
  process.env.NOTEFEED_OIDC_ALLOW = "a@x.com";
};
// Every NOTEFEED_OIDC_* variable, named providers' too.
const clear = () => Object.keys(process.env).filter((k) => k.startsWith("NOTEFEED_OIDC_")).forEach((k) => delete process.env[k]);
beforeEach(clear);
afterEach(clear);
const named = (name: string, v: Partial<Record<"ISSUER" | "CLIENT_ID" | "CLIENT_SECRET" | "ALLOW" | "SENDER_CLAIM" | "LABEL", string>>) => {
  for (const [k, val] of Object.entries(v)) process.env[`NOTEFEED_OIDC_${name}_${k}`] = val;
};
const FULL = { ISSUER: "https://alpha.example/realm", CLIENT_ID: "alpha-id", CLIENT_SECRET: "alpha-secret", ALLOW: "a@x.com" };

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
  expect(config.oidc()).toEqual({ issuer: "https://idp.example", clientId: "id", clientSecret: "secret", allow: ["a@x.com", "@y.com", "*"], senderClaim: ["name", "email"], label: "" });
});

const allow = (list: string, claims: { email?: string; email_verified?: boolean }) => {
  process.env.NOTEFEED_OIDC_ALLOW = list;
  return allowed({ allow: config.oidc().allow }, claims);
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

test("senderFrom: control and text-direction override characters become spaces; a claim of only those is skipped", () => {
  expect(senderFrom({ name: "An\u202en" }, NE)).toBe("An n");
  expect(senderFrom({ name: "\u202e\u2028", email: "a@x" }, NE)).toBe("a@x");
});

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

describe("several providers", () => {
  test("only the unprefixed set: one provider, id default, as before", () => {
    setAll();
    expect(providers()).toEqual([
      { id: "default", label: "idp.example", issuer: "https://idp.example", clientId: "id", clientSecret: "secret", allow: ["a@x.com"], senderClaim: ["name", "email"] },
    ]);
    expect(providerById("default")).toEqual(providers()[0]);
    expect(providerById("other")).toBeUndefined();
  });

  test("the unprefixed set and two named ones: default first, then by id", () => {
    setAll();
    named("BETA", { ...FULL, ISSUER: "https://beta.example", CLIENT_ID: "beta-id" });
    named("ALPHA", FULL);
    expect(providers().map((p) => p.id)).toEqual(["default", "alpha", "beta"]);
    expect(providerById("beta")).toMatchObject({ issuer: "https://beta.example", clientId: "beta-id", clientSecret: "alpha-secret", allow: ["a@x.com"] });
    expect(identityOn()).toBe(true);
  });

  test("named providers alone turn identity on; order is by id, not by variable name", () => {
    named("A_B", FULL);
    named("AB", FULL);
    named("A1", FULL);
    expect(providers().map((p) => p.id)).toEqual(["a1", "a_b", "ab"]);
    expect(identityOn()).toBe(true);
  });

  test("a named provider missing any of the four, or with an empty allow-list, is not active", () => {
    for (const k of ["ISSUER", "CLIENT_ID", "CLIENT_SECRET", "ALLOW"] as const) {
      clear();
      named("ALPHA", { ...FULL, [k]: "" });
      expect(providers()).toEqual([]);
      expect(identityOn()).toBe(false);
    }
    clear();
    named("ALPHA", { ...FULL, ALLOW: " , " });
    expect(providers()).toEqual([]);
    clear();
    named("ALPHA", { CLIENT_ID: "x", CLIENT_SECRET: "y", ALLOW: "*" });
    expect(providers()).toEqual([]);
  });

  test("a named DEFAULT is ignored; the unprefixed variables are not read as named ones", () => {
    named("DEFAULT", FULL);
    expect(providers()).toEqual([]);
    process.env.NOTEFEED_OIDC_ISSUER = "https://idp.example";
    process.env.NOTEFEED_OIDC_SENDER_CLAIM = "sub";
    process.env.NOTEFEED_OIDC_ALLOW = "*";
    process.env.NOTEFEED_OIDC_LABEL = "x";
    expect(providers()).toEqual([]);
    setAll();
    expect(providers().map((p) => p.id)).toEqual(["default"]);
  });

  test("names with underscores and digits; lowercase or malformed names are not providers", () => {
    named("MY_IDP", FULL);
    named("IDP2", FULL);
    for (const k of ["NOTEFEED_OIDC_lower_ISSUER", "NOTEFEED_OIDC__X_ISSUER", "NOTEFEED_OIDC_X__Y_ISSUER", "NOTEFEED_OIDC_X-Y_ISSUER"]) process.env[k] = FULL.ISSUER;
    expect(providers().map((p) => p.id)).toEqual(["idp2", "my_idp"]);
    expect(providerById("my_idp")).toMatchObject({ issuer: FULL.ISSUER, clientId: "alpha-id" });
  });

  test("label: _LABEL trimmed, else the issuer's host, else empty", () => {
    named("ALPHA", { ...FULL, LABEL: "  Company login " });
    named("BETA", { ...FULL, LABEL: "  " });
    named("GAMMA", { ...FULL, ISSUER: "not a url" });
    setAll();
    process.env.NOTEFEED_OIDC_LABEL = " Staff ";
    expect(providers().map((p) => [p.id, p.label])).toEqual([
      ["default", "Staff"],
      ["alpha", "Company login"],
      ["beta", "alpha.example"],
      ["gamma", ""],
    ]);
  });

  test("each provider has its own allow-list and sender claim", () => {
    named("ALPHA", { ...FULL, ALLOW: "ann@x.com", SENDER_CLAIM: " sub , email " });
    named("BETA", { ...FULL, ALLOW: "@y.com" });
    const [a, b] = [providerById("alpha")!, providerById("beta")!];
    expect(a.senderClaim).toEqual(["sub", "email"]);
    expect(b.senderClaim).toEqual(["name", "email"]);
    const ann = { email: "ann@x.com", email_verified: true };
    const bob = { email: "bob@y.com", email_verified: true };
    expect([allowed(a, ann), allowed(b, ann)]).toEqual([true, false]);
    expect([allowed(a, bob), allowed(b, bob)]).toEqual([false, true]);
  });
});
