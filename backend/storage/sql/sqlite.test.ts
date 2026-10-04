import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { describeStorage } from "../contract";
import { connect } from "./connect";
import { createSqlStorage, type SqlStorage } from ".";

// better-sqlite3 and kysely need Node 22 (the project's version); on an older Node the SQL tests are skipped.
const supported = Number(process.versions.node.split(".")[0]) >= 22;

const open: { storage: SqlStorage; root: string }[] = [];
async function fresh(file = "test.db") {
  const root = await mkdtemp(join(tmpdir(), "notefeed-sql-"));
  const url = `file:${join(root, file)}`;
  const storage = createSqlStorage(() => connect("sqlite", url));
  open.push({ storage, root });
  return { storage, root, url };
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
