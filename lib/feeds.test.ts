import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { FEED_RE, READ_ID_RE, RESERVED_FEEDS, checkFeed, feedForReadId, listFeeds, readId, resetSecretForTests } from "./feeds";
import { createNote } from "./notes";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-feeds-"));
  process.env.DATA_DIR = dir;
  delete process.env.NOTEFEED_SECRET;
  resetSecretForTests();
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
    process.env.NOTEFEED_SECRET = "s1";
    const a = readId("a");
    process.env.NOTEFEED_SECRET = "s2";
    resetSecretForTests();
    expect(readId("a")).not.toBe(a);
  });
  test("persists a 0600 .secret when no env is set", async () => {
    const id = readId("a");
    expect((await stat(join(dir, ".secret"))).mode & 0o777).toBe(0o600);
    resetSecretForTests();
    expect(readId("a")).toBe(id);
  });
});

describe("feedForReadId", () => {
  test("finds a feed by its read id", async () => {
    await createNote("alpha", "x");
    expect(await feedForReadId(readId("alpha"))).toBe("alpha");
    expect(await feedForReadId("A".repeat(22))).toBeNull();
    expect(await feedForReadId("short")).toBeNull();
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
});
