import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import {
  EmptyNoteError,
  NoteTooLargeError,
  createNote,
  getNote,
  isValidId,
  listNotes,
} from "./notes";
import { bodyAfterTitle, extractTitle, idStamp, slugify } from "./slug";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-"));
  process.env.DATA_DIR = dir;
});

const at = (iso: string) => new Date(iso);

describe("extractTitle", () => {
  test("uses the first heading", () => {
    expect(extractTitle("# Backup finished\nbody")).toBe("Backup finished");
  });
  test("falls back to the first non-empty line without markers", () => {
    expect(extractTitle("\n\n- **hello** world")).toBe("hello world");
    expect(extractTitle("> quoted")).toBe("quoted");
  });
  test("is empty for blank input", () => {
    expect(extractTitle("")).toBe("");
    expect(extractTitle("   \n")).toBe("");
  });
  test("caps at 100 chars", () => {
    expect(extractTitle("x".repeat(150))).toHaveLength(100);
  });
  test("ignores BOM and CRLF", () => {
    expect(extractTitle("﻿# Title\r\nbody")).toBe("Title");
  });
});

describe("slugify", () => {
  test("lowercases and dashes", () => {
    expect(slugify("Backup finished!")).toBe("backup-finished");
  });
  test("drops diacritics", () => {
    expect(slugify("Café notes")).toBe("cafe-notes");
  });
  test("falls back to note", () => {
    expect(slugify("🎉🎉")).toBe("note");
    expect(slugify("")).toBe("note");
  });
  test("caps at 50 chars with no trailing dash", () => {
    const s = slugify("word ".repeat(16));
    expect(s.length).toBeLessThanOrEqual(50);
    expect(s.endsWith("-")).toBe(false);
  });
});

test("idStamp formats UTC to the second", () => {
  expect(idStamp(at("2026-09-29T14:05:12.345Z"))).toBe("20260929T140512Z");
});

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
    const note = await createNote(md, at("2026-09-29T14:05:12Z"));
    expect(note.id).toBe("20260929T140512Z-backup-finished");
    expect(note.title).toBe("Backup finished");
    expect(note.createdAt).toEqual(at("2026-09-29T14:05:12Z"));
    expect(await readFile(join(dir, `${note.id}.md`), "utf8")).toBe(md);
  });

  test("suffixes collisions and never overwrites", async () => {
    const now = at("2026-09-29T14:05:12Z");
    const a = await createNote("# Same\nfirst", now);
    const b = await createNote("# Same\nsecond", now);
    const c = await createNote("# Same\nthird", now);
    expect(b.id).toBe(`${a.id}-2`);
    expect(c.id).toBe(`${a.id}-3`);
    expect(await readFile(join(dir, `${a.id}.md`), "utf8")).toBe("# Same\nfirst");
    expect((await readdir(dir)).every((f) => f.endsWith(".md"))).toBe(true);
  });

  test("keeps CRLF bytes", async () => {
    const note = await createNote("# T\r\nx\r\n");
    expect(await readFile(join(dir, `${note.id}.md`), "utf8")).toBe("# T\r\nx\r\n");
  });

  test("rejects empty notes", async () => {
    await expect(createNote("  \n")).rejects.toBeInstanceOf(EmptyNoteError);
  });

  test("limits by bytes, not characters", async () => {
    await expect(createNote("é".repeat(51200))).resolves.toBeTruthy();
    await expect(createNote("é".repeat(51200) + "x")).rejects.toBeInstanceOf(NoteTooLargeError);
  });

  test("creates a missing data dir", async () => {
    process.env.DATA_DIR = join(dir, "fresh");
    expect(await listNotes()).toEqual([]);
    await expect(createNote("hi")).resolves.toBeTruthy();
  });
});

describe("listNotes", () => {
  test("returns newest first, limited, ignoring stray files", async () => {
    await createNote("# One", at("2026-09-29T10:00:00Z"));
    await createNote("# Three", at("2026-09-29T12:00:00Z"));
    await createNote("# Two", at("2026-09-29T11:00:00Z"));
    await writeFile(join(dir, ".abc.tmp"), "x");
    await writeFile(join(dir, "README.txt"), "x");
    expect((await listNotes()).map((n) => n.title)).toEqual(["Three", "Two", "One"]);
    expect(await listNotes(2)).toHaveLength(2);
  });
});

describe("getNote", () => {
  test("rejects traversal ids", async () => {
    expect(await getNote("../x")).toBeNull();
  });
  test("returns null for unknown ids", async () => {
    expect(await getNote("20260101T000000Z-nope")).toBeNull();
  });
  test("reads an existing note", async () => {
    const created = await createNote("# Hi\nthere");
    const note = await getNote(created.id);
    expect(note?.markdown).toBe("# Hi\nthere");
    expect(note?.title).toBe("Hi");
  });
});

describe("bodyAfterTitle", () => {
  test("drops the heading used as title", () => {
    expect(bodyAfterTitle("# Backup finished\nnas-01 ok")).toBe("nas-01 ok");
  });
  test("drops the first line when it was the title", () => {
    expect(bodyAfterTitle("\n\nCert renewed\nmore")).toBe("more");
    expect(bodyAfterTitle("Cert renewed")).toBe("");
  });
  test("keeps everything when the title heading is further down", () => {
    expect(bodyAfterTitle("intro\n# Heading\nx")).toBe("intro\n# Heading\nx");
  });
});
