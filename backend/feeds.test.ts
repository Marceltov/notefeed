import { mkdir, mkdtemp, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { FEED_RE, READ_ID_RE, RESERVED_FEEDS, checkFeed, feedForReadId, listFeeds, readId, resetFeedsForTests } from "./feeds";
import { createNote } from "./notes";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-feeds-"));
  process.env.DATA_DIR = dir;
  delete process.env.NOTEFEED_SECRET;
  resetFeedsForTests();
});

describe("checkFeed", () => {
  test.each(["backups-7f3k2", "a", "x".repeat(64), "a_b"])("accepts %j", (n) => expect(checkFeed(n)).toBeNull());
  test.each(["", "x".repeat(65), "Backups", "a b", "..", "a/b", "a.b"])("invalid %j", (n) =>
    expect(checkFeed(n)).toBe("invalid"),
  );
  test("reserved names", () => {
    const names = [...RESERVED_FEEDS].filter((n) => FEED_RE.test(n));
    expect(names).toHaveLength(9);
    for (const n of names) expect(checkFeed(n)).toBe("reserved");
  });
});

describe("readId", () => {
  test("is 22 well-formed chars and stable", () => {
    const id = readId("a");
    expect(id).toHaveLength(22);
    expect(READ_ID_RE.test(id)).toBe(true);
    expect(readId("a")).toBe(id);
    expect(readId("b")).not.toBe(id);
  });
  test("depends on NOTEFEED_SECRET", () => {
    process.env.NOTEFEED_SECRET = "1".repeat(32);
    const a = readId("a");
    process.env.NOTEFEED_SECRET = "2".repeat(32);
    resetFeedsForTests();
    expect(readId("a")).not.toBe(a);
  });
  test("persists a 0600 .secret when no env is set", async () => {
    const id = readId("a");
    expect((await stat(join(dir, ".secret"))).mode & 0o777).toBe(0o600);
    resetFeedsForTests();
    expect(readId("a")).toBe(id);
  });
});

describe("secret strength", () => {
  test("an empty NOTEFEED_SECRET counts as unset", async () => {
    process.env.NOTEFEED_SECRET = "";
    readId("a");
    expect((await stat(join(dir, ".secret"))).size).toBe(32);
  });
  test("a NOTEFEED_SECRET shorter than 32 characters is an error", () => {
    process.env.NOTEFEED_SECRET = "x".repeat(31);
    expect(() => readId("a")).toThrow(/NOTEFEED_SECRET.*32/);
  });
  test.each([0, 5, 31])("a %i-byte .secret is an error, and the file is left alone", async (n) => {
    await writeFile(join(dir, ".secret"), "x".repeat(n));
    expect(() => readId("a")).toThrow(/\.secret.*32/);
    expect((await stat(join(dir, ".secret"))).size).toBe(n);
  });
});

describe("feedForReadId", () => {
  test("finds a feed by its read id", async () => {
    await createNote("alpha", "x");
    expect(await feedForReadId(readId("alpha"))).toBe("alpha");
    expect(await feedForReadId("A".repeat(22))).toBeNull();
    expect(await feedForReadId("short")).toBeNull();
  });

  test("finds feeds that were on disk before the index was built", async () => {
    await mkdir(join(dir, "beta"));
    expect(await feedForReadId(readId("beta"))).toBe("beta");
  });

  test("picks the matching feed among several", async () => {
    for (const f of ["alpha", "beta", "gamma"]) await createNote(f, "x");
    for (const f of ["alpha", "beta", "gamma"]) expect(await feedForReadId(readId(f))).toBe(f);
  });
});

describe("listFeeds", () => {
  test("lists only valid feed directories", async () => {
    await createNote("alpha", "x");
    await writeFile(join(dir, "flat.md"), "x");
    await writeFile(join(dir, ".secret"), "x");
    await mkdir(join(dir, "Bad Name"));
    await mkdir(join(dir, "api"));
    expect(await listFeeds()).toEqual(["alpha"]);
  });

  test("skips symlinks, even to a feed-like folder", async () => {
    const outside = await mkdtemp(join(tmpdir(), "notefeed-outside-"));
    await symlink(outside, join(dir, "linked"));
    expect(await listFeeds()).toEqual([]);
  });
});
