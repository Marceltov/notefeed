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
  removePassword,
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

test("hashPassword verifies for the right password only; hashes are salted", () => {
  const h = hashPassword("pw");
  expect(verifyHash("pw", h)).toBe(true);
  expect(verifyHash("no", h)).toBe(false);
  expect(hashPassword("pw")).not.toBe(h);
});

test("an unprotected feed passes for empty access", async () => {
  await expect(ok("open", {})).resolves.toBeUndefined();
});

describe("protected feed", () => {
  test("password and cookie access; a cookie from another feed fails", async () => {
    await createProtected("a", "pw");
    await createProtected("b", "pw");
    await expect(ok("a", { password: "pw" })).resolves.toBeUndefined();
    await expect(ok("a", {})).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { password: "no" })).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { cookie: (await cookieValue("a"))! })).resolves.toBeUndefined();
    await expect(ok("a", { cookie: (await cookieValue("b"))! })).rejects.toBeInstanceOf(AuthError);
  });

  test("cookieValue is null for an open feed", async () => {
    expect(await cookieValue("open")).toBeNull();
  });

  test("createProtected on a feed with notes throws FeedExistsError", async () => {
    await writeNote("notes", "n1", "hi");
    await expect(createProtected("notes", "pw")).rejects.toBeInstanceOf(FeedExistsError);
  });

  test("createProtected rejects a bad password", async () => {
    await expect(createProtected("a", "")).rejects.toBeInstanceOf(InvalidBodyError);
  });

  test("two concurrent creations: exactly one wins, only its password works", async () => {
    const res = await Promise.allSettled([createProtected("race", "x"), createProtected("race", "y")]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = res[0].status === "fulfilled" ? "x" : "y";
    const loser = winner === "x" ? "y" : "x";
    await expect(ok("race", { password: winner })).resolves.toBeUndefined();
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
    await expect(ok("a", {})).resolves.toBeUndefined();
  });

  test("changePassword and removePassword", async () => {
    await createProtected("a", "pw");
    const oldCookie = (await cookieValue("a"))!;
    await changePassword("a", "pw", "new", IP);
    await expect(ok("a", { password: "pw" })).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { cookie: oldCookie })).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { password: "new" })).resolves.toBeUndefined();
    await expect(removePassword("a", "pw", IP)).rejects.toBeInstanceOf(AuthError);
    await expect(changePassword("a", "pw", "x", IP)).rejects.toBeInstanceOf(AuthError);
    await removePassword("a", "new", IP);
    await expect(ok("a", {})).resolves.toBeUndefined();
  });

  test("change and remove on an open feed throw FeedExistsError", async () => {
    await writeNote("open", "n1", "hi");
    await expect(changePassword("open", "", "x", IP)).rejects.toBeInstanceOf(FeedExistsError);
    await expect(removePassword("open", "", IP)).rejects.toBeInstanceOf(FeedExistsError);
  });

  test("changePassword with an invalid new password keeps the old one", async () => {
    await createProtected("a", "pw");
    await expect(changePassword("a", "pw", "", IP)).rejects.toBeInstanceOf(InvalidBodyError);
    await expect(changePassword("a", "pw", "x".repeat(257), IP)).rejects.toBeInstanceOf(InvalidBodyError);
    await expect(ok("a", { password: "pw" })).resolves.toBeUndefined();
  });

  test("failed attempts are limited, even for the right password", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "2";
    await createProtected("a", "pw");
    await expect(ok("a", { password: "1" })).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { password: "2" })).rejects.toBeInstanceOf(AuthError);
    await expect(ok("a", { password: "pw" })).rejects.toBeInstanceOf(TooManyAttemptsError);
  });
});
