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
  test.each(["# Backup finished", "Café notes", "🎉🎉", "# "])("id and file name carry nothing of the title: %j", async (title) => {
    const { note } = await createNote("test", title + "\nok", at("2026-09-29T14:05:12Z"));
    expect(note.id).toMatch(/^20260929T140512Z-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await readFile(join(dir, `${note.id}.md`), "utf8")).toContain("ok");
  });
  test("writes the body byte-for-byte under a timestamped id", async () => {
    const md = "# Backup finished\nok";
    const { note } = await createNote("test", md, at("2026-09-29T14:05:12Z"));
    expect(note.id).toMatch(/^20260929T140512Z-[0-9a-f-]{36}$/);
    expect(note.title).toBe("Backup finished");
    expect(note.createdAt).toEqual(at("2026-09-29T14:05:12Z"));
    expect(await readFile(join(dir, `${note.id}.md`), "utf8")).toBe(md);
  });

  test("same second, same title: distinct ids, nothing overwritten", async () => {
    const now = at("2026-09-29T14:05:12Z");
    const { note: a } = await createNote("test", "# Same\nfirst", now);
    const { note: b } = await createNote("test", "# Same\nsecond", now);
    const { note: c } = await createNote("test", "# Same\nthird", now);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
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

describe("sender", () => {
  test("notes made in the same second list newest first", async () => {
    for (const ms of [100, 200, 300, 400, 500]) await createNote("test", `# N${ms}`, at(`2026-09-29T14:05:12.${ms}Z`));
    expect((await listNotes("test")).map((n) => n.title)).toEqual(["N500", "N400", "N300", "N200", "N100"]);
  });

  test("createNote stores the sender in the sidecar, the body as posted", async () => {
    const { note } = await createNote("test", "# Hi", undefined, "Ann");
    expect(note.sender).toBe("Ann");
    expect(await readFile(join(dir, `${note.id}.md`), "utf8")).toBe("# Hi");
    expect(JSON.parse(await readFile(join(dir, `.${note.id}.md.json`), "utf8"))).toEqual({ sender: "Ann" });
    const got = await getNote("test", note.id);
    expect(got?.markdown).toBe("# Hi");
    expect(got?.sender).toBe("Ann");
    expect(got?.title).toBe("Hi");
  });
  test("updateNote keeps the sender", async () => {
    const { note } = await createNote("test", "# Old", undefined, "Ann");
    const u = await updateNote("test", note.id, "# New");
    expect(u?.sender).toBe("Ann");
    expect((await getNote("test", note.id))?.sender).toBe("Ann");
    expect((await getNote("test", note.id))?.markdown).toBe("# New");
  });
  test.each(["a\u2028b", "a\u2029b", "a\rb"])("sender %j survives create, get and update", async (sender) => {
    const { note } = await createNote("test", "# Hi", undefined, sender);
    expect((await getNote("test", note.id))?.sender).toBe(sender);
    expect((await updateNote("test", note.id, "# New"))?.sender).toBe(sender);
    expect(await getNote("test", note.id)).toMatchObject({ markdown: "# New", sender });
  });
  test("a typed block in the body is body: no sender from it, with or without ours", async () => {
    const typed = '---\nsender: "Boss"\n---\nhi';
    const { note: a } = await createNote("test", typed);
    expect(await getNote("test", a.id)).toMatchObject({ markdown: typed });
    expect((await getNote("test", a.id))?.sender).toBeUndefined();
    const { note: b } = await createNote("test", typed, undefined, "Ann");
    expect(await readFile(join(dir, `${b.id}.md`), "utf8")).toBe(typed);
    expect(await getNote("test", b.id)).toMatchObject({ markdown: typed, sender: "Ann" });
  });
  test("an edit leaves the sidecar as it is, unknown fields included", async () => {
    await createNote("test", "# Seed");
    await writeFile(join(dir, "20260101T000000Z-k.md"), "old");
    await writeFile(join(dir, ".20260101T000000Z-k.md.json"), '{"sender":"Ann","extra":1}');
    expect((await updateNote("test", "20260101T000000Z-k", "new"))?.sender).toBe("Ann");
    expect(await readFile(join(dir, ".20260101T000000Z-k.md.json"), "utf8")).toBe('{"sender":"Ann","extra":1}');
  });
  test("a sidecar title wins over the one derived from the text", async () => {
    await createNote("test", "# Seed");
    await writeFile(join(dir, "20260101T000000Z-t.md"), "# Derived");
    await writeFile(join(dir, ".20260101T000000Z-t.md.json"), '{"title":"Set"}');
    expect((await getNote("test", "20260101T000000Z-t"))?.title).toBe("Set");
  });
  test("a note with a broken sidecar is a note with no metadata", async () => {
    await createNote("test", "# Seed");
    await writeFile(join(dir, "20260101T000000Z-b.md"), "# B");
    await writeFile(join(dir, ".20260101T000000Z-b.md.json"), "{nope");
    expect(await getNote("test", "20260101T000000Z-b")).toMatchObject({ title: "B", tags: [] });
  });
  test("a file on disk with no sidecar still lists, without a sender", async () => {
    const { note } = await createNote("test", "# One");
    await writeFile(join(dir, "20260101T000000Z-hand.md"), "# Hand");
    const all = await listNotes("test");
    expect(all.map((n) => n.markdown).sort()).toEqual(["# Hand", "# One"]);
    expect(all.every((n) => n.sender === undefined)).toBe(true);
    expect(note.sender).toBeUndefined();
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
    expect(u).toMatchObject({ id: n.id, title: "New", markdown: "# New\nbody", createdAt: now, tags: [] });
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
