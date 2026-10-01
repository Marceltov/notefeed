import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { listNoteFiles, writeNote } from "./data/notes";
import { AuthError, FeedExistsError, InvalidBodyError, TooManyAttemptsError } from "./errors";
import {
  changePassword,
  checkFeedAccess,
  cookieValue,
  createProtected,
  hashPassword,
  protectedFeed,
  removePassword,
  unlock,
  verifyHash,
} from "./feedlock";
import { listFeeds, resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";

const IP = "1.2.3.4";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-lock-"));
  process.env.DATA_DIR = dir;
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  delete process.env.NOTEFEED_RATE_LIMIT;
  resetFeedsForTests();
  resetRateLimitsForTests();
});

const ok = (feed: string, a: { password?: string; cookie?: string }) => checkFeedAccess(feed, a, IP);

test("hashPassword verifies for the right password only; hashes are salted", async () => {
  const h = await hashPassword("pw");
  expect(await verifyHash("pw", h)).toBe(true);
  expect(await verifyHash("no", h)).toBe(false);
  expect(await hashPassword("pw")).not.toBe(h);
  expect(await verifyHash("pw", "scrypt$1$1$1$$")).toBe(false);
  expect(await verifyHash("pw", "scrypt$3$8$1$c2FsdA==$aGFzaA==")).toBe(false); // N is not a power of two
});

test("an unprotected feed passes for any access, proving nothing", async () => {
  await expect(ok("open", {})).resolves.toBe(false);
  await expect(ok("open", { password: "x", cookie: "y" })).resolves.toBe(false);
});

describe("protected feed", () => {
  test("password and cookie access; a cookie from another feed fails", async () => {
    await createProtected("a", "pw");
    await createProtected("b", "pw");
    await expect(ok("a", { password: "pw" })).resolves.toBe(true);
    await expect(ok("a", {})).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { password: "no" })).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { cookie: (await cookieValue("a"))! })).resolves.toBe(true);
    await expect(ok("a", { cookie: (await cookieValue("b"))! })).rejects.toBeInstanceOf(AuthError);
  });

  test("cookieValue is null for an open feed", async () => {
    expect(await cookieValue("open")).toBeNull();
  });

  test("createProtected on a feed with notes throws FeedExistsError", async () => {
    await writeNote("notes", "n1", "hi");
    await expect(createProtected("notes", "pw")).rejects.toBeInstanceOf(FeedExistsError);
  });

  test.each(["", "x".repeat(257), "pässwort", "emoji 🔑", " lead", "trail ", "new\nline", "\x7f"])("createProtected rejects the password %j", async (bad) => {
    await expect(createProtected("a", bad)).rejects.toBeInstanceOf(InvalidBodyError);
    expect(await protectedFeed("a")).toBe(false);
  });

  test.each(["x", "x".repeat(256), "two words", "~!@#$%^&*()"])("createProtected accepts the password %j", async (good) => {
    await createProtected("a", good);
    await expect(ok("a", { password: good })).resolves.toBe(true);
  });

  test("two concurrent creations: exactly one wins, only its password works", async () => {
    const res = await Promise.allSettled([createProtected("race", "x"), createProtected("race", "y")]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = res[0].status === "fulfilled" ? "x" : "y";
    const loser = winner === "x" ? "y" : "x";
    await expect(ok("race", { password: winner })).resolves.toBe(true);
    await expect(ok("race", { password: loser })).rejects.toBeInstanceOf(AuthError);
    const lost = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(AuthError);
  });

  test(".password is not a note and the feed is listed once", async () => {
    await createProtected("a", "pw");
    expect(await listNoteFiles("a")).toEqual([]);
    resetFeedsForTests();
    expect((await listFeeds()).filter((f) => f === "a")).toHaveLength(1);
  });

  test("deleting .password by hand opens the feed at once", async () => {
    await createProtected("a", "pw");
    await expect(ok("a", {})).rejects.toBeInstanceOf(AuthError);
    await rm(join(dir, "a", ".password"));
    await expect(ok("a", {})).resolves.toBe(false);
  });

  test("changePassword and removePassword", async () => {
    await createProtected("a", "pw");
    const oldCookie = (await cookieValue("a"))!;
    await changePassword("a", "pw", "new", IP);
    await expect(ok("a", { password: "pw" })).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { cookie: oldCookie })).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { password: "new" })).resolves.toBe(true);
    await expect(removePassword("a", "pw", IP)).rejects.toBeInstanceOf(AuthError);
    await expect(changePassword("a", "pw", "x", IP)).rejects.toBeInstanceOf(AuthError);
    await removePassword("a", "new", IP);
    await expect(ok("a", {})).resolves.toBe(false);
  });

  test("change and remove on an open feed throw FeedExistsError", async () => {
    await writeNote("open", "n1", "hi");
    await expect(changePassword("open", "", "x", IP)).rejects.toBeInstanceOf(FeedExistsError);
    await expect(removePassword("open", "", IP)).rejects.toBeInstanceOf(FeedExistsError);
  });

  test("changePassword with an invalid new password keeps the old one", async () => {
    await createProtected("a", "pw");
    await expect(changePassword("a", "pw", "", IP)).rejects.toBeInstanceOf(InvalidBodyError);
    for (const bad of ["x".repeat(257), "pässwort", " lead", "trail "])
      await expect(changePassword("a", "pw", bad, IP)).rejects.toBeInstanceOf(InvalidBodyError);
    await expect(ok("a", { password: "pw" })).resolves.toBe(true);
  });

  test("a bad cookie alone never touches the limiter", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "2";
    await createProtected("a", "pw");
    for (let i = 0; i < 10; i++) await expect(ok("a", { cookie: "stale" })).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { password: "pw" })).resolves.toBe(true);
  });

  test("no password is refused but never touches the limiter", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "2";
    await createProtected("a", "pw");
    for (const access of [{}, { password: "" }, { password: "", cookie: "stale" }])
      for (let i = 0; i < 5; i++) await expect(ok("a", access)).rejects.toBeInstanceOf(AuthError);
    for (let i = 0; i < 5; i++) {
      await expect(unlock("a", "", IP)).rejects.toBeInstanceOf(AuthError);
      await expect(removePassword("a", "", IP)).rejects.toBeInstanceOf(AuthError);
      await expect(changePassword("a", "", "new", IP)).rejects.toBeInstanceOf(AuthError);
    }
    await expect(ok("a", { password: "pw" })).resolves.toBe(true);
  });

  test("changePassword returns the cookie for the new password", async () => {
    await createProtected("a", "pw");
    const cookie = await changePassword("a", "pw", "new", IP);
    expect(cookie).toBe(await cookieValue("a"));
    await expect(ok("a", { cookie })).resolves.toBe(true);
  });

  // The password check awaits scrypt, so the attempt has to be counted before it, not after.
  test("a burst of concurrent guesses gets no more compared than the limit allows", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "3";
    await createProtected("a", "pw");
    const guesses = [...Array.from({ length: 40 }, (_, i) => `wrong-${i}`), "pw"];
    const res = await Promise.allSettled(guesses.map((password) => ok("a", { password })));
    const compared = res.filter((r) => r.status === "fulfilled" || r.reason instanceof AuthError);
    expect(compared.length).toBeLessThanOrEqual(3);
    for (const r of res) if (!compared.includes(r)) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(TooManyAttemptsError);
  });

  test("right passwords, one after another or at once, never use up the limit", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "3";
    await createProtected("a", "pw");
    for (let i = 0; i < 10; i++) await expect(ok("a", { password: "pw" })).resolves.toBe(true);
    // At once, those beyond the limit may be asked to wait while the first are still hashing, but none fails.
    const burst = await Promise.allSettled(Array.from({ length: 20 }, () => ok("a", { password: "pw" })));
    expect(burst.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(3);
    for (const r of burst) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(TooManyAttemptsError);
    // Afterwards the budget is whole again: three wrong ones are still compared, and only then is it used up.
    for (let i = 0; i < 3; i++) await expect(ok("a", { password: `wrong-${i}` })).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { password: "pw" })).rejects.toBeInstanceOf(TooManyAttemptsError);
  });

  test("failed attempts are limited, even for the right password", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "2";
    await createProtected("a", "pw");
    await expect(ok("a", { password: "1" })).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { password: "2" })).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { password: "pw" })).rejects.toBeInstanceOf(TooManyAttemptsError);
  });
});
