import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { resetFeedsForTests } from "../feeds";
import { TTL, cid, newJti, resetTokensForTests, sign, useOnce, verify } from "./tokens";

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-tokens-"));
  process.env.NOTEFEED_SECRET = "s".repeat(40);
  process.env.NOTEFEED_PASSWORD = "pw";
  resetFeedsForTests();
  resetTokensForTests();
});

const NOW = 1_700_000_000_000;
const samples = {
  client: { client_name: "c", redirect_uris: ["http://x/cb"] },
  code: { cid: "a", redirect_uri: "http://x/cb", code_challenge: "ch", resource: "http://x/mcp", jti: "j" },
  access: { aud: "http://x/mcp" },
  refresh: { cid: "a", aud: "http://x/mcp", jti: "j" },
};
const kinds = Object.keys(samples) as (keyof typeof samples)[];

describe("sign/verify", () => {
  test.each(kinds)("round trip %s", (k) => {
    const out = verify(k, sign(k, samples[k] as never, NOW), NOW) as Record<string, unknown>;
    expect(out).toMatchObject(samples[k]);
    expect(out.exp).toBe(k === "client" ? undefined : NOW / 1000 + TTL[k]);
  });

  test("wrong kind", () => expect(verify("access", sign("refresh", samples.refresh, NOW), NOW)).toBeNull());

  test("expiry", () => {
    const t = sign("access", samples.access, NOW);
    const exp = NOW / 1000 + TTL.access;
    expect(verify("access", t, exp * 1000)).not.toBeNull();
    expect(verify("access", t, exp * 1000 + 1)).toBeNull();
  });

  test("client has no expiry", () => expect(verify("client", sign("client", samples.client, NOW), NOW + 1e13)).not.toBeNull());

  test("a flipped character in payload or MAC is rejected", () => {
    const t = sign("access", samples.access, NOW);
    for (const i of [0, 5, t.length - 1, t.length - 5]) {
      const bad = t.slice(0, i) + (t[i] === "A" ? "B" : "A") + t.slice(i + 1);
      expect(verify("access", bad, NOW)).toBeNull();
    }
  });

  test("password or secret change invalidates", () => {
    const t = sign("access", samples.access, NOW);
    process.env.NOTEFEED_PASSWORD = "other";
    expect(verify("access", t, NOW)).toBeNull();
    process.env.NOTEFEED_PASSWORD = "pw";
    expect(verify("access", t, NOW)).not.toBeNull();
    process.env.NOTEFEED_SECRET = "z".repeat(40);
    resetFeedsForTests();
    expect(verify("access", t, NOW)).toBeNull();
  });

  test.each(["", "a.b.c", ".", "a.", "!!!.???", "e30.e30", "%%%"])("garbage %j", (g) =>
    expect(verify("access", g, NOW)).toBeNull(),
  );
});

describe("helpers", () => {
  test("cid", () => {
    expect(cid("x")).toHaveLength(22);
    expect(cid("x")).toBe(cid("x"));
    expect(cid("x")).not.toBe(cid("y"));
  });
  test("newJti is unique base64url", () => {
    expect(newJti()).toMatch(/^[\w-]{22}$/);
    expect(newJti()).not.toBe(newJti());
  });
  test("useOnce", () => {
    expect(useOnce("j", 100, 0)).toBe(true);
    expect(useOnce("j", 100, 50_000)).toBe(false);
    expect(useOnce("j", 300, 200_000)).toBe(true); // the old entry expired and was pruned
  });
});
