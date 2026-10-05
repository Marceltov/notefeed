import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { describeStorage } from "../contract";
import { createFsImageStore } from "../images/fs";
import type { ImageStore } from "../images/types";
import { FeedGoneError } from "../types";
import { logsOf } from "../../log";
import { connect } from "./connect";
import { createSqlStorage, type Images, type SqlStorage } from ".";

// better-sqlite3 and kysely need Node 22 (the project's version); on an older Node the SQL tests are skipped.
const supported = Number(process.versions.node.split(".")[0]) >= 22;

const open: { storage: SqlStorage; root: string }[] = [];
async function fresh(file = "test.db", images?: Images) {
  const root = await mkdtemp(join(tmpdir(), "notefeed-sql-"));
  const url = `file:${join(root, file)}`;
  const storage = createSqlStorage(() => connect("sqlite", url), "sqlite", images);
  open.push({ storage, root });
  return { storage, root, url };
}

// An image store in memory that says what was asked of it and can be told to fail.
function recording() {
  const objects = new Map<string, Buffer>();
  const calls: string[] = [];
  const failing = new Set<"put" | "get" | "delete">();
  const check = (op: "put" | "get" | "delete") => {
    calls.push(op);
    if (failing.has(op)) throw new Error(`image store: ${op} failed (500)`);
  };
  const store: ImageStore = {
    async put(key, bytes) {
      check("put");
      objects.set(key, Buffer.from(bytes));
    },
    async get(key) {
      check("get");
      return objects.get(key) ?? null;
    },
    async delete(key) {
      check("delete");
      objects.delete(key);
    },
  };
  return { objects, calls, failing, images: { store, external: (ext: string) => ext === "png" } satisfies Images };
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x00]);
const ALL = ["md", "png"];
async function rawRows(url: string) {
  const Database = (await import("better-sqlite3")).default;
  const raw = new Database(url.slice("file:".length), { readonly: true });
  const rows = raw.prepare("select id, ext, length(content) as inline, blob_key, size from notes order by id").all() as { id: string; ext: string; inline: number; blob_key: string | null; size: number }[];
  raw.close();
  return rows;
}
afterEach(async () => {
  for (const { storage, root } of open.splice(0)) {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

describe.skipIf(!supported)("sqlite", () => {
  describeStorage("sqlite", async () => {
    const { storage } = await fresh();
    return { storage, cleanup: async () => {} };
  });

  describeStorage("sqlite with images in a folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "notefeed-sql-images-"));
    const { storage } = await fresh("test.db", { store: createFsImageStore(root), external: (ext) => ext === "png" });
    return { storage, cleanup: () => rm(root, { recursive: true, force: true }) };
  });

  test("a database from before the image store gets each note's size, and its notes read as before", async () => {
    const a = await fresh();
    await a.storage.createFeed("f", "rid-f");
    await a.storage.writeNote("f", "t", "md", "héllo", {});
    await a.storage.writeNote("f", "p", "png", PNG, {});
    await a.storage.close();
    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(a.url.slice("file:".length));
    raw.exec("alter table notes drop column blob_key; alter table notes drop column size; delete from kysely_migration where name = '002_image_store'");
    raw.close();
    const again = createSqlStorage(() => connect("sqlite", a.url));
    open.push({ storage: again, root: a.root });
    expect((await again.readNote("f", "t", ALL, () => true))?.content.toString()).toBe("héllo");
    expect((await again.readNote("f", "p", ALL, () => false))?.size).toBe(PNG.byteLength);
    expect(await rawRows(a.url)).toEqual([
      { id: "p", ext: "png", inline: PNG.byteLength, blob_key: null, size: PNG.byteLength },
      { id: "t", ext: "md", inline: 6, blob_key: null, size: 6 },
    ]);
  });

  describe("with an image store", () => {
    async function setup() {
      const rec = recording();
      const made = await fresh("test.db", rec.images);
      await made.storage.createFeed("f", "rid-f");
      return { ...rec, ...made, s: made.storage };
    }

    test("an image's bytes go to the store and its row holds the key; a text note stays in its row", async () => {
      const { s, url, objects, calls } = await setup();
      await s.writeNote("f", "t", "md", "text", {});
      expect(calls).toEqual([]);
      await s.writeNote("f", "p", "png", PNG, { alt: "a" });
      const [p, t] = await rawRows(url);
      expect(t).toEqual({ id: "t", ext: "md", inline: 4, blob_key: null, size: 4 });
      expect(p).toMatchObject({ inline: 0, size: PNG.byteLength });
      expect([...objects.keys()]).toEqual([p.blob_key]);
      expect(p.blob_key).toMatch(/^[0-9a-f]{32}$/);
      expect(objects.get(p.blob_key!)).toEqual(PNG);
    });

    test("an image reads back byte for byte, by note and by file name, and its size needs no trip to the store", async () => {
      const { s, calls } = await setup();
      await s.writeNote("f", "p", "png", PNG, { alt: "a" });
      calls.length = 0;
      const listed = await s.readNote("f", "p", ALL, () => false);
      expect(listed).toMatchObject({ ext: "png", size: PNG.byteLength, meta: { alt: "a" } });
      expect(listed?.content.byteLength).toBe(0);
      expect(await s.listNoteRefs("f")).toEqual([{ id: "p", ext: "png" }]);
      expect(await s.readMeta("f", { id: "p", ext: "png" })).toEqual({ alt: "a" });
      expect(calls).toEqual([]);
      expect((await s.readNote("f", "p", ALL, () => true))?.content).toEqual(PNG);
      expect(await s.readFile("f", "p.png")).toEqual(PNG);
      expect(calls).toEqual(["get", "get"]);
    });

    test("an image posted to a feed deleted meanwhile is a FeedGoneError and leaves no object", async () => {
      const { s, objects, calls } = await setup();
      await s.deleteFeed("f");
      await expect(s.writeNote("f", "p", "png", PNG, {})).rejects.toBeInstanceOf(FeedGoneError);
      expect(calls).toEqual(["put", "delete"]);
      expect(objects.size).toBe(0);
    });

    test("when the store refuses the image, no note is made", async () => {
      const { s, failing } = await setup();
      failing.add("put");
      await expect(s.writeNote("f", "p", "png", PNG, {})).rejects.toThrow("image store: put failed (500)");
      expect(await s.listNoteRefs("f")).toEqual([]);
    });

    test("two images with the same base get their own ids and their own objects", async () => {
      const { s, objects, url } = await setup();
      const ids = await Promise.all([s.writeNote("f", "p", "png", Buffer.from("one"), {}), s.writeNote("f", "p", "png", Buffer.from("two"), {})]);
      expect(ids.sort()).toEqual(["p", "p-2"]);
      const rows = await rawRows(url);
      expect(new Set(rows.map((r) => r.blob_key)).size).toBe(2);
      expect(objects.size).toBe(2);
      const got = await Promise.all(ids.map(async (id) => (await s.readFile("f", `${id}.png`))?.toString()));
      expect(got.sort()).toEqual(["one", "two"]);
    });

    test("deleting an image removes its object, the row first", async () => {
      const { s, objects, calls } = await setup();
      await s.writeNote("f", "p", "png", PNG, {});
      calls.length = 0;
      expect(await s.deleteNote("f", "p", ALL)).toBe(true);
      expect(calls).toEqual(["delete"]);
      expect(objects.size).toBe(0);
      expect(await s.deleteNote("f", "p", ALL)).toBe(false);
      expect(calls).toEqual(["delete"]);
    });

    test("a store that cannot delete does not fail the deletion: the note is gone, the object stays, and it is logged", async () => {
      const { s, objects, failing } = await setup();
      await s.writeNote("f", "p", "png", PNG, {});
      failing.add("delete");
      const logs = await logsOf(async () => expect(await s.deleteNote("f", "p", ALL)).toBe(true));
      expect(await s.listNoteRefs("f")).toEqual([]);
      expect(objects.size).toBe(1);
      expect(logs.filter((l) => l.level === "warn")).toHaveLength(1);
      expect(JSON.stringify(logs)).not.toContain([...objects.keys()][0]);
    });

    test("replacing an image writes a new object and removes the old one", async () => {
      const { s, objects, url } = await setup();
      await s.writeNote("f", "p", "png", PNG, {});
      const before = (await rawRows(url))[0].blob_key;
      expect(await s.replaceNote("f", "p", ALL, Buffer.from("new bytes"))).toBe(true);
      const after = (await rawRows(url))[0];
      expect(after.blob_key).not.toBe(before);
      expect(after).toMatchObject({ inline: 0, size: 9 });
      expect([...objects.keys()]).toEqual([after.blob_key]);
      expect((await s.readFile("f", "p.png"))?.toString()).toBe("new bytes");
    });

    test("replacing a note that is not there leaves no object", async () => {
      const { s, objects, calls } = await setup();
      expect(await s.replaceNote("f", "nope", ALL, PNG)).toBe(false);
      expect(calls).toEqual([]);
      expect(objects.size).toBe(0);
    });

    test("replacing a text note never reaches the store", async () => {
      const { s, calls } = await setup();
      await s.writeNote("f", "t", "md", "one", {});
      expect(await s.replaceNote("f", "t", ALL, "two")).toBe(true);
      expect((await s.readNote("f", "t", ALL, () => true))?.content.toString()).toBe("two");
      expect(calls).toEqual([]);
    });

    test("two replacements at once leave one object, the one the row names", async () => {
      const { s, objects, url } = await setup();
      await s.writeNote("f", "p", "png", PNG, {});
      await Promise.all([s.replaceNote("f", "p", ALL, Buffer.from("one")), s.replaceNote("f", "p", ALL, Buffer.from("two"))]);
      expect([...objects.keys()]).toEqual([(await rawRows(url))[0].blob_key]);
    });

    test("deleting a feed removes its images' objects and no other feed's", async () => {
      const { s, objects } = await setup();
      await s.createFeed("g", "rid-g");
      await s.writeNote("f", "p", "png", PNG, {});
      await s.writeNote("f", "q", "png", PNG, {});
      await s.writeNote("f", "t", "md", "x", {});
      await s.writeNote("g", "p", "png", Buffer.from("g's"), {});
      expect(await s.deleteFeed("f")).toBe(true);
      expect(objects.size).toBe(1);
      expect((await s.readFile("g", "p.png"))?.toString()).toBe("g's");
      expect(await s.deleteFeed("f")).toBe(false);
    });

    test("an image stored in its row before the store was set is still read, and moves to the store when replaced", async () => {
      const plain = await fresh();
      await plain.storage.createFeed("f", "rid-f");
      await plain.storage.writeNote("f", "old", "png", PNG, {});
      await plain.storage.close();
      const rec = recording();
      const s = createSqlStorage(() => connect("sqlite", plain.url), "sqlite", rec.images);
      open.push({ storage: s, root: plain.root });
      expect(await s.readFile("f", "old.png")).toEqual(PNG);
      expect((await s.readNote("f", "old", ALL, () => true))?.content).toEqual(PNG);
      expect(rec.calls).toEqual([]);
      await s.writeNote("f", "new", "png", Buffer.from("n"), {});
      expect(await s.replaceNote("f", "old", ALL, Buffer.from("moved"))).toBe(true);
      expect(rec.objects.size).toBe(2);
      expect((await rawRows(plain.url)).map((r) => r.inline)).toEqual([0, 0]);
      expect((await s.readFile("f", "old.png"))?.toString()).toBe("moved");
      expect(await s.deleteNote("f", "old", ALL)).toBe(true);
    });

    test("an image whose object is gone reads as no image, is logged, and the listing goes on", async () => {
      const { s, objects } = await setup();
      await s.writeNote("f", "p", "png", PNG, { alt: "a" });
      await s.writeNote("f", "t", "md", "text", {});
      const key = [...objects.keys()][0];
      objects.clear();
      const logs = await logsOf(async () => {
        expect(await s.readFile("f", "p.png")).toBeNull();
        expect(await s.readNote("f", "p", ALL, () => true)).toBeNull();
      });
      expect(logs.filter((l) => l.level === "error")).toHaveLength(2);
      expect(JSON.stringify(logs)).not.toContain(key);
      expect(await s.listNoteRefs("f")).toHaveLength(2);
      expect((await s.readNote("f", "p", ALL, () => false))?.size).toBe(PNG.byteLength);
      expect((await s.readNote("f", "t", ALL, () => true))?.content.toString()).toBe("text");
      expect(await s.deleteNote("f", "p", ALL)).toBe(true);
    });

    test("a store that does not answer fails the image, not the listing or the text notes", async () => {
      const { s, failing } = await setup();
      await s.writeNote("f", "p", "png", PNG, {});
      await s.writeNote("f", "t", "md", "text", {});
      failing.add("get");
      await expect(s.readFile("f", "p.png")).rejects.toThrow("image store: get failed (500)");
      expect(await s.listNoteRefs("f")).toHaveLength(2);
      expect(await s.readMeta("f", { id: "p", ext: "png" })).toEqual({});
      expect((await s.readFile("f", "t.md"))?.toString()).toBe("text");
    });

    test("a row that names a key is not read as an empty image when no store is configured", async () => {
      const { s, url, root } = await setup();
      await s.writeNote("f", "p", "png", PNG, {});
      await s.close();
      const plain = createSqlStorage(() => connect("sqlite", url));
      open.push({ storage: plain, root });
      const logs = await logsOf(async () => expect(await plain.readFile("f", "p.png")).toBeNull());
      expect(logs.filter((l) => l.level === "error")).toHaveLength(1);
    });
  });

  test("a second start on the same database migrates nothing and keeps the data", async () => {
    const a = await fresh();
    await a.storage.createFeed("f", "rid-f");
    await a.storage.writeNote("f", "n", "md", "x", {});
    await a.storage.close();
    const again = createSqlStorage(() => connect("sqlite", a.url));
    open.push({ storage: again, root: a.root });
    expect(await again.feedReadId("f")).toBe("rid-f");
    expect(await again.listNoteRefs("f")).toEqual([{ id: "n", ext: "md" }]);
  });

  test("a database made by a newer notefeed fails with a clear message", async () => {
    const a = await fresh();
    await a.storage.createFeed("f", "rid-f");
    await a.storage.close();
    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(a.url.slice("file:".length));
    raw.prepare("insert into kysely_migration (name, timestamp) values ('999_from_the_future', ?)").run(new Date().toISOString());
    raw.close();
    const again = createSqlStorage(() => connect("sqlite", a.url));
    open.push({ storage: again, root: a.root });
    await expect(again.feedReadId("f")).rejects.toThrow(/newer notefeed/);
  });

  test("deleting a feed leaves no notes behind", async () => {
    const { storage, url } = await fresh();
    await storage.createFeed("f", "rid-f");
    await storage.writeNote("f", "n", "md", "x", {});
    await storage.deleteFeed("f");
    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(url.slice("file:".length), { readonly: true });
    expect(raw.prepare("select count(*) as c from notes").get()).toEqual({ c: 0 });
    raw.close();
  });

  test("a database that cannot be opened says NOTEFEED_DATABASE_URL and not the path", async () => {
    const root = await mkdtemp(join(tmpdir(), "notefeed-sql-"));
    const url = `file:${join(root, "no-such-dir", "deeper", "x.db")}`;
    const storage = createSqlStorage(() => connect("sqlite", url));
    open.push({ storage, root });
    // the folder is created for a file URL, so make the path impossible instead: a file where a folder must be
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, "no-such-dir"), "a file");
    const err = await storage.feedReadId("f").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/NOTEFEED_DATABASE_URL/);
    expect((err as Error).message).not.toContain(root);
    expect((err as Error).cause).toBeUndefined(); // the driver's error would carry the path
  });
});
