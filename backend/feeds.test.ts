import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ReservedFeedError } from "./errors";
import { logTo } from "./log";
import { FEED_RE, deleteFeed, READ_ID_RE, RESERVED_FEEDS, checkFeed, derivedReadId, ensureFeed, feedCount, feedForReadId, hasFeed, listFeeds, readIdOf, resetFeedsForTests } from "./feeds";
import { createProtected, protectedFeed } from "./feedlock";
import { createNote, listNotes } from "./notes";

// Log lines, captured per test.
let logs: string[] = [];
let restoreLog = () => {};
beforeEach(() => {
  logs = [];
  restoreLog = logTo((l) => void logs.push(l));
});
afterEach(() => restoreLog());

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
  test("oauth is reserved", () => expect(checkFeed("oauth")).toBe("reserved"));
  test("reserved names", () => {
    const names = [...RESERVED_FEEDS].filter((n) => FEED_RE.test(n));
    expect(names).toHaveLength(10);
    for (const n of names) expect(checkFeed(n)).toBe("reserved");
  });
});

describe("derivedReadId", () => {
  test("is 22 well-formed chars and stable", () => {
    const id = derivedReadId("a");
    expect(id).toHaveLength(22);
    expect(READ_ID_RE.test(id)).toBe(true);
    expect(derivedReadId("a")).toBe(id);
    expect(derivedReadId("b")).not.toBe(id);
  });
  test("depends on NOTEFEED_SECRET", () => {
    process.env.NOTEFEED_SECRET = "1".repeat(32);
    const a = derivedReadId("a");
    process.env.NOTEFEED_SECRET = "2".repeat(32);
    resetFeedsForTests();
    expect(derivedReadId("a")).not.toBe(a);
  });
  test("persists a 0600 .secret when no env is set", async () => {
    const id = derivedReadId("a");
    expect((await stat(join(dir, ".secret"))).mode & 0o777).toBe(0o600);
    resetFeedsForTests();
    expect(derivedReadId("a")).toBe(id);
  });
});

describe("secret strength", () => {
  test("an empty NOTEFEED_SECRET counts as unset", async () => {
    process.env.NOTEFEED_SECRET = "";
    derivedReadId("a");
    expect((await stat(join(dir, ".secret"))).size).toBe(32);
  });
  test("a NOTEFEED_SECRET shorter than 32 characters is an error", () => {
    process.env.NOTEFEED_SECRET = "x".repeat(31);
    expect(() => derivedReadId("a")).toThrow(/NOTEFEED_SECRET.*32/);
  });
  test.each([0, 5, 31])("a %i-byte .secret is an error, and the file is left alone", async (n) => {
    await writeFile(join(dir, ".secret"), "x".repeat(n));
    expect(() => derivedReadId("a")).toThrow(/\.secret.*32/);
    expect((await stat(join(dir, ".secret"))).size).toBe(n);
  });
});

describe("feedForReadId", () => {
  test("finds a feed by its read id", async () => {
    await createNote("alpha", "x");
    expect(await feedForReadId((await readIdOf("alpha"))!)).toBe("alpha");
    expect(await feedForReadId("A".repeat(22))).toBeNull();
    expect(await feedForReadId("short")).toBeNull();
  });

  test("finds feeds that were on disk before the index was built", async () => {
    await mkdir(join(dir, "beta"));
    expect(await feedForReadId(derivedReadId("beta"))).toBe("beta");
  });

  test("picks the matching feed among several", async () => {
    for (const f of ["alpha", "beta", "gamma"]) await createNote(f, "x");
    for (const f of ["alpha", "beta", "gamma"]) expect(await feedForReadId((await readIdOf(f))!)).toBe(f);
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

describe("per-feed read ids", () => {
  const readid = (f: string) => readFile(join(dir, f, ".readid"), "utf8");

  test("a legacy feed (no .readid) keeps its derived id across a restart, and no file is written", async () => {
    await mkdir(join(dir, "old"));
    const id = derivedReadId("old");
    expect(await readIdOf("old")).toBe(id);
    resetFeedsForTests();
    expect(await readIdOf("old")).toBe(id);
    expect(await feedForReadId(id)).toBe("old");
    expect(await readdir(join(dir, "old"))).toEqual([]);
  });

  test("a new feed gets a stored random id that survives a restart", async () => {
    await createNote("fresh", "x");
    const id = (await readid("fresh")).trim();
    expect(await readIdOf("fresh")).toBe(id);
    expect(READ_ID_RE.test(id)).toBe(true);
    expect(id).not.toBe(derivedReadId("fresh"));
    resetFeedsForTests();
    expect(await readIdOf("fresh")).toBe(id);
    expect(await feedForReadId(id)).toBe("fresh");
  });

  test("legacy and new feeds both resolve", async () => {
    await mkdir(join(dir, "old"));
    await createNote("fresh", "x");
    expect(await feedForReadId(derivedReadId("old"))).toBe("old");
    expect(await feedForReadId((await readIdOf("fresh"))!)).toBe("fresh");
    expect(await feedForReadId(derivedReadId("fresh"))).toBeNull();
  });

  test("a junk .readid falls back to the derived id", async () => {
    await mkdir(join(dir, "bad"));
    await writeFile(join(dir, "bad", ".readid"), "junk");
    expect(await readIdOf("bad")).toBe(derivedReadId("bad"));
  });

  test("an unknown feed has no read id", async () => expect(await readIdOf("nope")).toBeNull());

  test("deleteFeed drops the feed from the index", async () => {
    await createNote("gone", "x");
    const id = (await readIdOf("gone"))!;
    await deleteFeed("gone");
    expect(await hasFeed("gone")).toBe(false);
    expect(await feedForReadId(id)).toBeNull();
    expect(await feedCount()).toBe(0);
  });

  test("two concurrent first creations end with one .readid and the same id", async () => {
    const [x, y] = await Promise.all([ensureFeed("race"), ensureFeed("race")]);
    await Promise.all([createNote("race", "a"), createNote("race", "b")]);
    expect(x).toBe(y);
    expect((await readdir(join(dir, "race"))).filter((n) => n.startsWith("."))).toEqual([".readid"]);
    expect((await readid("race")).trim()).toBe(x);
    expect(await readIdOf("race")).toBe(x);
  });

  test("the id is on disk before the feed has content, so a failed creation can't lose it", async () => {
    const id = await ensureFeed("early"); // as if the note write after it failed
    expect(await readdir(join(dir, "early"))).toEqual([".readid"]);
    resetFeedsForTests();
    expect(await readIdOf("early")).toBe(id);
    expect(id).not.toBe(derivedReadId("early"));
  });

  test("a protected feed has .readid in it from the moment it exists", async () => {
    await createProtected("locked2", "correct horse battery");
    resetFeedsForTests();
    expect(await readIdOf("locked2")).not.toBe(derivedReadId("locked2"));
  });

  test("a copied .readid: the later feed gets its derived id, the first keeps its link", async () => {
    for (const f of ["a", "b"]) {
      await mkdir(join(dir, f));
      await writeFile(join(dir, f, ".readid"), "A".repeat(22));
    }
    expect(await readIdOf("a")).toBe("A".repeat(22));
    expect(await readIdOf("b")).toBe(derivedReadId("b"));
    expect(await feedForReadId("A".repeat(22))).toBe("a");
    await deleteFeed("b");
    expect(await feedForReadId("A".repeat(22))).toBe("a");
    expect(await feedForReadId(derivedReadId("b"))).toBeNull();
  });

  test("logs a junk or duplicate .readid without the feed name", async () => {
    await mkdir(join(dir, "secretjunk"));
    await writeFile(join(dir, "secretjunk", ".readid"), "junk");
    await mkdir(join(dir, "secretdup"));
    await writeFile(join(dir, "secretdup", ".readid"), "A".repeat(22));
    await mkdir(join(dir, "secretdup2"));
    await writeFile(join(dir, "secretdup2", ".readid"), "A".repeat(22));
    await readIdOf("secretjunk");
    const out = logs.join(" ");
    expect(logs.map((l) => JSON.parse(l).level)).toEqual(["warn", "warn"]);
    expect(out).not.toContain("secret");
  });

  test("a hand-made .readid equal to another feed's derived id: the first keeps the link, the other has none", async () => {
    for (const f of ["a", "d"]) {
      await mkdir(join(dir, f));
      await writeFile(join(dir, f, ".readid"), derivedReadId("d")); // d's own derived id, also a's stored one
    }
    expect(await feedForReadId(derivedReadId("d"))).toBe("a");
    expect(await listFeeds()).toEqual(["a", "d"]);
    expect(await readIdOf("d")).toBeNull(); // not a's link
    expect(logs.map((l) => JSON.parse(l).msg).join(" ")).not.toMatch(/\bd\b/);
    expect(logs.join(" ")).not.toContain('"d"');
    await deleteFeed("d"); // must not take a's link away
    expect(await feedForReadId(derivedReadId("d"))).toBe("a");
  });

  test("a .readid that can't be read: the other feeds load, and that one is listed without a read link", async () => {
    await createNote("fine", "x");
    await mkdir(join(dir, "secretbroken", ".readid"), { recursive: true }); // EISDIR
    resetFeedsForTests();
    expect(await feedForReadId((await readIdOf("fine"))!)).toBe("fine");
    expect(await listFeeds()).toEqual(["fine", "secretbroken"]);
    expect(await readIdOf("secretbroken")).toBeNull();
    expect(await feedForReadId(derivedReadId("secretbroken"))).toBeNull(); // not the derived id: that would change its link
    expect(await ensureFeed("secretbroken")).toBeNull();
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toMatchObject({ level: "error", component: "feeds", err: { code: "EISDIR" } });
    expect(logs.join(" ")).not.toContain("secret");
  });

  test(".readid is not a note and not a feed", async () => {
    await createNote("alpha", "x");
    await writeFile(join(dir, ".readid"), "x");
    resetFeedsForTests();
    expect(await listFeeds()).toEqual(["alpha"]);
  });

  test("a protected feed gets a stored id too, and .readid is no note", async () => {
    await createProtected("locked", "correct horse battery");
    expect(await readIdOf("locked")).toBe((await readid("locked")).trim());
    expect(await listNotes("locked")).toEqual([]);
  });
});

describe("deleteFeed", () => {
  const readid = (f: string) => readFile(join(dir, f, ".readid"), "utf8");
  test("drops the feed, its directory and its read id; a re-created feed is a new one", async () => {
    await createNote("gone", "x");
    const old = (await readIdOf("gone"))!;
    expect(await deleteFeed("gone")).toBe(true);
    expect(await hasFeed("gone")).toBe(false);
    expect(await feedForReadId(old)).toBeNull();
    expect(await deleteFeed("gone")).toBe(false);
    await createNote("gone", "y");
    expect(await readIdOf("gone")).not.toBe(old);
    expect((await readid("gone")).trim()).toBe(await readIdOf("gone"));
  });

  test("a note write in flight while the feed is deleted makes a new, complete feed", async () => {
    await createNote("busy", "x");
    const old = (await readIdOf("busy"))!;
    for (let i = 0; i < 20; i++) {
      const [, { note }] = await Promise.all([deleteFeed("busy"), createNote("busy", `# n${i}`)]);
      expect(note.id).toBeTruthy();
      const files = await readdir(join(dir, "busy"));
      expect(files).toContain(".readid"); // never a half-feed
      expect((await readid("busy")).trim()).toBe(await readIdOf("busy"));
      expect(await feedForReadId(old)).toBeNull();
      expect((await readdir(dir)).filter((n) => n.startsWith(".deleted-"))).toEqual([]);
    }
  });

  test("a protected creation in flight while the feed is deleted wins cleanly", async () => {
    await createProtected("prot", "correct horse battery");
    const [, created] = await Promise.all([deleteFeed("prot"), createProtected("prot", "another password").then(() => true, () => false)]);
    expect(created).toBe(true);
    expect(await hasFeed("prot")).toBe(true);
  });
});

describe("a feed directory removed by hand while notefeed runs", () => {
  test("a post makes the feed anew, with a new read id", async () => {
    await createNote("hand", "# one");
    const old = (await readIdOf("hand"))!;
    await rm(join(dir, "hand"), { recursive: true });
    const { note, readId } = await createNote("hand", "# two");
    expect((await listNotes("hand")).map((n) => n.id)).toEqual([note.id]);
    expect(readId).not.toBe(old);
    expect(await readIdOf("hand")).toBe(readId);
    expect((await readFile(join(dir, "hand", ".readid"), "utf8")).trim()).toBe(readId);
    expect(await feedForReadId(old)).toBeNull();
  });

  test("deleting it says there is no such feed, and forgets it", async () => {
    await createNote("hand", "# one");
    await rm(join(dir, "hand"), { recursive: true });
    expect(await deleteFeed("hand")).toBe(false);
    expect(await hasFeed("hand")).toBe(false);
  });
});

describe("leftovers of a crash", () => {
  test("a creation's temp directory is removed when the index loads; nothing else is", async () => {
    const names = [".0123456789ab.tmp", ".0123456789ab.tmpx", ".0123456789AB.tmp", ".short.tmp"];
    for (const n of names) await mkdir(join(dir, n));
    await writeFile(join(dir, ".ba9876543210.tmp"), "a file, not a directory");
    await writeFile(join(dir, names[0], ".readid"), "A".repeat(22));
    expect(await listFeeds()).toEqual([]);
    expect((await readdir(dir)).sort()).toEqual([".0123456789AB.tmp", ".0123456789ab.tmpx", ".ba9876543210.tmp", ".short.tmp"]);
  });
});

describe("held-back names", () => {
  afterEach(() => { delete process.env.NOTEFEED_RESERVED_FEEDS; });
  test("a configured name can't be created, a normal one can", async () => {
    process.env.NOTEFEED_RESERVED_FEEDS = "jobs, extra";
    for (const n of ["jobs", "extra"]) await expect(ensureFeed(n)).rejects.toBeInstanceOf(ReservedFeedError);
    await expect(ensureFeed("mine")).resolves.toBeTruthy();
  });
});

describe("reserved feeds with a password", () => {
  afterEach(() => { delete process.env.NOTEFEED_RESERVED_PASSWORD; delete process.env.NOTEFEED_RESERVED_FEEDS; });
  test("exist protected with their name as read id, also after a delete and a restart", async () => {
    process.env.NOTEFEED_RESERVED_PASSWORD = "operator-pass-1";
    process.env.NOTEFEED_RESERVED_FEEDS = "news";
    expect(await hasFeed("news")).toBe(true);
    expect(await readIdOf("news")).toBe("news");
    expect(await protectedFeed("news")).toBe(true);
    await deleteFeed("news");
    resetFeedsForTests();
    expect(await readIdOf("news")).toBe("news");
  });
  test("don't exist without it", async () => {
    expect(await hasFeed("news")).toBe(false);
  });
});

test("a reserved feed is found by its name as read id", async () => {
  process.env.NOTEFEED_RESERVED_PASSWORD = "operator-pass-1";
    process.env.NOTEFEED_RESERVED_FEEDS = "news";
  expect(await feedForReadId("news")).toBe("news");
  delete process.env.NOTEFEED_RESERVED_PASSWORD;
  delete process.env.NOTEFEED_RESERVED_FEEDS;
});
