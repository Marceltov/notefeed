import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { EmptyNoteError, InvalidFeedError, NoteTooLargeError, ReservedFeedError } from "./errors";
import { hasFeed } from "./feeds";
import { countNotes, createNote, getNote, isValidId, listNotes, removeNote, updateNote } from "./notes";

let root: string;
let dir: string; // the "test" feed's directory
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "notefeed-"));
  process.env.DATA_DIR = root;
  dir = join(root, "test");
});

// The feed directory's files, without the `.readid` every new feed gets.
const files = async () => (await readdir(dir)).filter((f) => f !== ".readid");
const at = (iso: string) => new Date(iso);

describe("isValidId", () => {
  test("accepts a real id", () => {
    expect(isValidId("20260929T140512Z-backup-finished")).toBe(true);
  });
  test.each(["../etc/passwd", "20260929T140512Z-a/../../x", "20260929T140512Z-A", ""])(
    "rejects %j",
    (id) => expect(isValidId(id)).toBe(false),
  );
});

describe("createNote", () => {
  test("writes the body byte-for-byte under a timestamped id", async () => {
    const md = "# Backup finished\nok";
    const { note } = await createNote("test", md, at("2026-09-29T14:05:12Z"));
    expect(note.id).toBe("20260929T140512Z-backup-finished");
    expect(note.title).toBe("Backup finished");
    expect(note.createdAt).toEqual(at("2026-09-29T14:05:12Z"));
    expect(await readFile(join(dir, `${note.id}.md`), "utf8")).toBe(md);
  });

  test("suffixes collisions and never overwrites", async () => {
    const now = at("2026-09-29T14:05:12Z");
    const { note: a } = await createNote("test", "# Same\nfirst", now);
    const { note: b } = await createNote("test", "# Same\nsecond", now);
    const { note: c } = await createNote("test", "# Same\nthird", now);
    expect(b.id).toBe(`${a.id}-2`);
    expect(c.id).toBe(`${a.id}-3`);
    expect(await readFile(join(dir, `${a.id}.md`), "utf8")).toBe("# Same\nfirst");
    expect((await files()).every((f) => f.endsWith(".md"))).toBe(true);
  });

  test("keeps CRLF bytes", async () => {
    const { note } = await createNote("test", "# T\r\nx\r\n");
    expect(await readFile(join(dir, `${note.id}.md`), "utf8")).toBe("# T\r\nx\r\n");
  });

  test("rejects empty notes", async () => {
    await expect(createNote("test", "  \n")).rejects.toBeInstanceOf(EmptyNoteError);
  });

  test("limits by bytes, not characters", async () => {
    await expect(createNote("test", "é".repeat(51200))).resolves.toBeTruthy();
    await expect(createNote("test", "é".repeat(51200) + "x")).rejects.toBeInstanceOf(NoteTooLargeError);
  });

  test("creates a missing data dir", async () => {
    process.env.DATA_DIR = join(root, "fresh");
    expect(await listNotes("test")).toEqual([]);
    await expect(createNote("test", "hi")).resolves.toBeTruthy();
  });
});

describe("listNotes", () => {
  test("returns newest first, limited, ignoring stray files", async () => {
    await createNote("test", "# One", at("2026-09-29T10:00:00Z"));
    await createNote("test", "# Three", at("2026-09-29T12:00:00Z"));
    await createNote("test", "# Two", at("2026-09-29T11:00:00Z"));
    await writeFile(join(dir, ".abc.tmp"), "x");
    await writeFile(join(dir, "README.txt"), "x");
    expect((await listNotes("test")).map((n) => n.title)).toEqual(["Three", "Two", "One"]);
    expect(await listNotes("test", 2)).toHaveLength(2);
  });
});

describe("feeds", () => {
  test("notes are isolated per feed", async () => {
    const { note: n } = await createNote("a", "# Hi");
    expect(await listNotes("b")).toEqual([]);
    expect(await getNote("b", n.id)).toBeNull();
    expect(await listNotes("a")).toHaveLength(1);
  });
  test("flat files in DATA_DIR are ignored", async () => {
    await writeFile(join(root, "20260929T140512Z-flat.md"), "# Flat");
    expect(await listNotes("test")).toEqual([]);
    expect(await getNote("test", "20260929T140512Z-flat")).toBeNull();
  });
  test.each([
    ["Bad Name", InvalidFeedError],
    ["", InvalidFeedError],
    ["api", ReservedFeedError],
    ["login", ReservedFeedError],
    ["_next", ReservedFeedError],
  ])("createNote rejects invalid or reserved feed %j and writes nothing", async (feed, cls) => {
    await expect(createNote(feed, "hi")).rejects.toBeInstanceOf(cls);
    expect(await readdir(root)).toEqual([]);
  });
  test("countNotes", async () => {
    expect(await countNotes("test")).toBe(0);
    await createNote("test", "# One");
    await createNote("test", "# Two");
    await writeFile(join(dir, "README.txt"), "x");
    expect(await countNotes("test")).toBe(2);
  });
  test("hasFeed", async () => {
    expect(await hasFeed("test")).toBe(false);
    await createNote("test", "hi");
    expect(await hasFeed("test")).toBe(true);
    expect(await hasFeed("api")).toBe(false);
  });
});

describe("getNote", () => {
  test("rejects traversal ids", async () => {
    expect(await getNote("test", "../x")).toBeNull();
  });
  test("returns null for unknown ids", async () => {
    expect(await getNote("test", "20260101T000000Z-nope")).toBeNull();
  });
  test("reads an existing note", async () => {
    const { note: created } = await createNote("test", "# Hi\nthere");
    const note = await getNote("test", created.id);
    expect(note?.markdown).toBe("# Hi\nthere");
    expect(note?.title).toBe("Hi");
  });
});

describe("updateNote and removeNote", () => {
  const now = at("2026-09-29T14:05:12Z");
  test("an edit keeps the id and createdAt, changes markdown and title", async () => {
    const { note: n } = await createNote("test", "# Old", now);
    const u = await updateNote("test", n.id, "# New\nbody");
    expect(u).toEqual({ id: n.id, title: "New", markdown: "# New\nbody", createdAt: now });
    expect((await getNote("test", n.id))?.markdown).toBe("# New\nbody");
  });
  test("a missing note is null and creates no file", async () => {
    await createNote("test", "# Old", now);
    expect(await updateNote("test", "20260101T000000Z-x", "# New")).toBeNull();
    expect(await files()).toHaveLength(1);
  });
  test("a refused edit leaves the file and no temp file", async () => {
    const { note: n } = await createNote("test", "# Old", now);
    await expect(updateNote("test", n.id, "  ")).rejects.toThrow(EmptyNoteError);
    expect(await readFile(join(dir, `${n.id}.md`), "utf8")).toBe("# Old");
    expect(await files()).toEqual([`${n.id}.md`]);
  });
  test("removeNote is true once, then false", async () => {
    const { note: n } = await createNote("test", "# Old", now);
    expect(await removeNote("test", n.id)).toBe(true);
    expect(await removeNote("test", n.id)).toBe(false);
    expect(await getNote("test", n.id)).toBeNull();
  });
  test.each(["../x", ".password", "a/b"])("id %j touches nothing", async (id) => {
    await createNote("test", "# Old", now);
    await writeFile(join(dir, ".password"), "hash");
    expect(await updateNote("test", id, "# New")).toBeNull();
    expect(await removeNote("test", id)).toBe(false);
    expect(await readFile(join(dir, ".password"), "utf8")).toBe("hash");
    expect(await files()).toHaveLength(2);
  });
});

test("editing a note whose feed was deleted meanwhile is no such note, not a crash", async () => {
  const { updateNote } = await import("./notes");
  const { deleteFeed } = await import("./feeds");
  const { note: n } = await createNote("gone", "# a");
  const p = updateNote("gone", n.id, "# b"); // stat has passed by the time the directory goes
  await deleteFeed("gone");
  expect(await p).toBeNull();
});
