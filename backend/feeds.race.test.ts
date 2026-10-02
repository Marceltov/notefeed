import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";

// Deletion and creation interleaved on purpose, by slowing single filesystem calls:
// `rename`: the delete's rename is "slow" (waits, then renames), "held" (renames, then waits: the directory
// is gone and the index still lists the feed) or "fails" (EACCES). `readId`: reading `.readid` is slow.
const knobs = vi.hoisted(() => ({ rename: "" as "" | "slow" | "held" | "fails", readId: false, readIdFails: false }));
const pause = (ms = 50) => new Promise((r) => setTimeout(r, ms));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rename: async (from: string, to: string) => {
      if (!String(to).includes(".deleted-")) return fs.rename(from, to);
      if (knobs.rename === "fails") throw Object.assign(new Error("not allowed"), { code: "EACCES" });
      if (knobs.rename === "slow") await pause();
      await fs.rename(from, to);
      if (knobs.rename === "held") await pause();
    },
    readFile: async (path: string, ...rest: unknown[]) => {
      if (knobs.readId && String(path).endsWith(".readid")) await pause();
      if (knobs.readIdFails && String(path).endsWith(".readid")) throw Object.assign(new Error("too many open files"), { code: "EMFILE" });
      return (fs.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
    },
  };
});

const { deleteFeed, feedForReadId, hasFeed, readIdOf, resetFeedsForTests } = await import("./feeds");
const { createProtected, protectedFeed } = await import("./feedlock");
const { createNote, listNotes } = await import("./notes");

let dir: string;
let old: string;
beforeEach(async () => {
  dir = process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-race-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  knobs.rename = "";
  knobs.readId = false;
  knobs.readIdFails = false;
  resetFeedsForTests();
  await createNote("w", "x");
  old = (await readIdOf("w"))!;
});

// What every interleaving must end in: the index and the disk agree, the stored id is the indexed one,
// and the deleted feed's read id is dead.
async function consistent(): Promise<boolean> {
  const there = existsSync(join(dir, "w"));
  expect(await hasFeed("w")).toBe(there);
  expect(await feedForReadId(old)).toBeNull();
  if (!there) return false;
  const id = await readIdOf("w");
  expect(id).not.toBe(old);
  expect((await readFile(join(dir, "w", ".readid"), "utf8")).trim()).toBe(id);
  expect(await feedForReadId(id!)).toBe("w");
  return true;
}

test("a delete with a slow rename and a post started in the same tick", async () => {
  knobs.rename = "slow";
  const [deleted] = await Promise.all([deleteFeed("w"), createNote("w", "# y")]);
  expect(deleted).toBe(true);
  expect(await consistent()).toBe(false); // the post landed before the delete: it is gone with the feed
});

test("the same right after a restart, when both wait for the index to load", async () => {
  resetFeedsForTests();
  knobs.rename = "slow";
  await Promise.all([deleteFeed("w"), createNote("w", "# y")]);
  await consistent();
});

test("a post while the directory is gone and the index still lists the feed makes a new feed", async () => {
  knobs.rename = "held";
  const deleting = deleteFeed("w");
  await pause(20);
  const { note } = await createNote("w", "# y");
  expect(await deleting).toBe(true); // and must leave the new feed alone
  expect(await consistent()).toBe(true);
  expect((await listNotes("w")).map((n) => n.id)).toEqual([note.id]);
});

test("a protected creation in that window gets the name, with a new read id", async () => {
  knobs.rename = "held";
  const deleting = deleteFeed("w");
  await pause(20);
  await createProtected("w", "correct horse battery");
  await deleting;
  expect(await consistent()).toBe(true);
  expect(await protectedFeed("w")).toBe(true);
});

test("of two deletes one finds the feed", async () => {
  knobs.rename = "slow";
  expect((await Promise.all([deleteFeed("w"), deleteFeed("w")])).sort()).toEqual([false, true]);
  expect(await consistent()).toBe(false);
  knobs.rename = "held";
  await createNote("w", "x");
  const first = deleteFeed("w");
  await pause(20);
  expect(await deleteFeed("w")).toBe(false);
  expect(await first).toBe(true);
  expect(await consistent()).toBe(false);
});

test("a rename that fails for another reason than a missing directory leaves the index and the disk as they were", async () => {
  knobs.rename = "fails";
  await expect(deleteFeed("w")).rejects.toThrow("not allowed");
  expect(await readIdOf("w")).toBe(old);
  expect(await feedForReadId(old)).toBe("w");
  expect((await listNotes("w")).length).toBe(1);
});

test("a creation that lost to another one, whose feed is deleted before it reads the winner's .readid", async () => {
  await deleteFeed("w");
  knobs.readId = true;
  const posts = Promise.all([createNote("w", "# a"), createNote("w", "# b")]); // one makes the feed, the other waits for its .readid
  await pause(20);
  expect(await deleteFeed("w")).toBe(true);
  await posts;
  knobs.readId = false;
  expect(await consistent()).toBe(true);
  expect((await listNotes("w")).length).toBe(1); // the loser's note, in a feed of its own
});

test("a creation that lost the race and can't read the winner's .readid fails, registers nothing for it, and a retry works", async () => {
  knobs.readIdFails = true;
  const posts = await Promise.allSettled([createNote("nf", "# a"), createNote("nf", "# b")]);
  knobs.readIdFails = false;
  expect(posts.filter((p) => p.status === "rejected")).toHaveLength(1);
  const id = await readIdOf("nf");
  expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect((await readFile(join(dir, "nf", ".readid"), "utf8")).trim()).toBe(id);
  await createNote("nf", "# c"); // the retry
  expect(await readIdOf("nf")).toBe(id);
});
