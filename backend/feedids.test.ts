import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { NameTakenError, InvalidBodyError, NotFoundError, ReservedFeedError } from "./errors";
import { createProtected, protectedFeed } from "./feedlock";
import { derivedReadId, ensureFeed, feedForReadId, hasFeed, isRetired, readIdOf, renameFeed, resetFeedsForTests, setReadId } from "./feeds";
import { createNote, listNotes } from "./notes";
import { updateFeed } from "./posting";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-feedids-"));
  process.env.DATA_DIR = dir;
  delete process.env.NOTEFEED_SECRET;
  delete process.env.NOTEFEED_ALLOW_CUSTOM_IDS;
  delete process.env.NOTEFEED_RESERVED_FEEDS;
  resetFeedsForTests();
});

const body = (o: object) => async () => ({ title: "", description: "", ...o });

describe("renameFeed", () => {
  test("moves notes and password, keeps the read id, retires the old name", async () => {
    await createProtected("old", "pw");
    const { note } = await createNote("old", "# Hi");
    const id = await readIdOf("old");
    await renameFeed("old", "new");
    expect(await hasFeed("old")).toBe(false);
    expect((await listNotes("new")).map((n) => n.id)).toEqual([note.id]);
    expect(await protectedFeed("new")).toBe(true);
    expect(await readIdOf("new")).toBe(id);
    expect(await feedForReadId(id!)).toBe("new");
    expect(await isRetired("name", "old")).toBe(true);
    await expect(ensureFeed("old")).rejects.toBeInstanceOf(NotFoundError); // not created again
  });

  test("a legacy feed keeps its derived read id", async () => {
    await createNote("legacy", "# Hi");
    await rm(join(dir, "legacy", ".readid"));
    resetFeedsForTests();
    const id = derivedReadId("legacy");
    await renameFeed("legacy", "other");
    resetFeedsForTests();
    expect(await readIdOf("other")).toBe(id);
  });

  test("the record survives a restart", async () => {
    await createNote("old", "# Hi");
    await renameFeed("old", "new");
    resetFeedsForTests();
    expect(await isRetired("name", "old")).toBe(true);
    expect(await hasFeed("new")).toBe(true);
  });

  test("refuses a taken, retired, reserved or invalid name, and an unknown feed", async () => {
    await createNote("a", "# A");
    await createNote("b", "# B");
    await expect(renameFeed("a", "b")).rejects.toBeInstanceOf(NameTakenError);
    await renameFeed("a", "c");
    await expect(renameFeed("b", "a")).rejects.toBeInstanceOf(NameTakenError); // retired
    await expect(renameFeed("b", "login")).rejects.toBeInstanceOf(ReservedFeedError);
    await expect(renameFeed("b", "Bad Name")).rejects.toThrow();
    await expect(renameFeed("nope", "d")).rejects.toBeInstanceOf(NotFoundError);
    process.env.NOTEFEED_RESERVED_FEEDS = "news";
    await expect(renameFeed("b", "news")).rejects.toBeInstanceOf(ReservedFeedError);
  });

  test("two renames to one name: one wins", async () => {
    await createNote("a", "# A");
    await createNote("b", "# B");
    const results = await Promise.allSettled([renameFeed("a", "x"), renameFeed("b", "x")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("setReadId", () => {
  test("a chosen id replaces the old one, which is retired", async () => {
    await createNote("f", "# Hi");
    const old = (await readIdOf("f"))!;
    expect(await setReadId("f", "my-feed")).toBe("my-feed");
    expect(await readIdOf("f")).toBe("my-feed");
    expect(await feedForReadId("my-feed")).toBe("f");
    expect(await feedForReadId(old)).toBeNull();
    expect(await isRetired("id", old)).toBe(true);
    expect((await readFile(join(dir, "f", ".readid"), "utf8")).trim()).toBe("my-feed");
    resetFeedsForTests();
    expect(await readIdOf("f")).toBe("my-feed");
  });

  test("null makes a random one", async () => {
    await createNote("f", "# Hi");
    const old = await readIdOf("f");
    const fresh = await setReadId("f", null);
    expect(fresh).not.toBe(old);
    expect(fresh).toHaveLength(22);
  });

  test("refuses another feed's id, a retired one, a bad one and a reserved feed's", async () => {
    await createNote("a", "# A");
    await createNote("b", "# B");
    await setReadId("a", "taken");
    await expect(setReadId("b", "taken")).rejects.toBeInstanceOf(NameTakenError);
    await setReadId("a", "moved");
    await expect(setReadId("b", "taken")).rejects.toBeInstanceOf(NameTakenError); // retired
    for (const bad of ["ab", "UPPER", "a b", "x".repeat(65)]) await expect(setReadId("b", bad)).rejects.toBeInstanceOf(InvalidBodyError);
    process.env.NOTEFEED_RESERVED_FEEDS = "updates";
    await expect(setReadId("b", "updates")).rejects.toBeInstanceOf(NameTakenError);
  });

  test("only the record and the feed are left in DATA_DIR", async () => {
    await createNote("f", "# Hi");
    await setReadId("f", "my-feed");
    expect((await readdir(dir)).sort()).toEqual([".retired", "f"]);
  });
});

describe("updateFeed with name and read_id", () => {
  const ip = "1.2.3.4";
  test("renames and changes the read id in one write, saves the settings", async () => {
    await createNote("old", "# Hi");
    const r = await updateFeed("old", ip, body({ title: "T", name: "new", readId: "readable" }), {});
    expect(r).toMatchObject({ name: "new", title: "T" });
    expect(await readIdOf("new")).toBe("readable");
  });

  test("omitted or unchanged leaves both alone", async () => {
    await createNote("f", "# Hi");
    const id = await readIdOf("f");
    expect((await updateFeed("f", ip, body({ name: "f", readId: id! }), {})).name).toBe("f");
    expect(await readIdOf("f")).toBe(id);
  });

  test("an empty read_id is a random one", async () => {
    await createNote("f", "# Hi");
    const id = await readIdOf("f");
    await updateFeed("f", ip, body({ readId: "" }), {});
    expect(await readIdOf("f")).not.toBe(id);
  });

  test("an invalid name writes nothing", async () => {
    await createNote("f", "# Hi");
    await expect(updateFeed("f", ip, body({ title: "T", name: "Bad Name" }), {})).rejects.toThrow();
    expect(await hasFeed("f")).toBe(true);
  });

  test("a reserved feed is not renamable and keeps its read id", async () => {
    process.env.NOTEFEED_RESERVED_FEEDS = "news";
    process.env.NOTEFEED_RESERVED_PASSWORD = "pw";
    resetFeedsForTests();
    await expect(updateFeed("news", ip, body({ name: "other" }), { password: "pw" })).rejects.toBeInstanceOf(InvalidBodyError);
    await expect(updateFeed("news", ip, body({ readId: "" }), { password: "pw" })).rejects.toBeInstanceOf(InvalidBodyError);
    delete process.env.NOTEFEED_RESERVED_PASSWORD;
  });

  test("NOTEFEED_ALLOW_CUSTOM_IDS=0 allows only a random read id", async () => {
    process.env.NOTEFEED_ALLOW_CUSTOM_IDS = "0";
    await createNote("f", "# Hi");
    await expect(updateFeed("f", ip, body({ name: "g" }), {})).rejects.toBeInstanceOf(InvalidBodyError);
    await expect(updateFeed("f", ip, body({ readId: "chosen" }), {})).rejects.toBeInstanceOf(InvalidBodyError);
    await expect(updateFeed("f", ip, body({ readId: "" }), {})).resolves.toBeTruthy();
  });
});
