import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { UnsupportedTypeError } from "./errors";
import { resetFeedsForTests } from "./feeds";
import { contentTypeOf, sniffImage } from "./images";
import { createImageNote, createNote, getNote, hasImageNote, listNotes, removeNote } from "./notes";
import { ImageNote } from "./note/image";

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-img-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  delete process.env.NOTEFEED_MAX_IMAGES_PER_FEED;
  resetFeedsForTests();
});

const bytes = (...b: number[]) => new Uint8Array(b);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const GIF = new TextEncoder().encode("GIF89a\x01\x00");
const WEBP = new TextEncoder().encode("RIFF\x10\x00\x00\x00WEBPVP8 ");
const png = (n: number) => bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n);

describe("sniffImage", () => {
  test.each([
    ["png", PNG],
    ["jpg", JPG],
    ["gif", GIF],
    ["webp", WEBP],
  ] as const)("%s by its first bytes", (type, b) => expect(sniffImage(b)).toBe(type));
  test.each([
    ["svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["html", new TextEncoder().encode("<!doctype html><script>alert(1)</script>")],
    ["empty", new Uint8Array()],
    ["3 bytes", bytes(0x89, 0x50, 0x4e)],
    ["RIFF but not WebP", new TextEncoder().encode("RIFF\x10\x00\x00\x00WAVEfmt ")],
  ])("%s is not an image", (_n, b) => expect(sniffImage(b)).toBeNull());
});

test("contentTypeOf names the served type of an extension", () => {
  expect(contentTypeOf("png")).toBe("image/png");
  expect(contentTypeOf("jpg")).toBe("image/jpeg");
  expect(contentTypeOf("md")).toBe("text/plain; charset=utf-8");
  expect(contentTypeOf("pdf")).toBe("application/octet-stream");
});

describe("createImageNote", () => {
  const feedDir = () => join(process.env.DATA_DIR!, "pics");
  test("stores the bytes as <id>.png with a sidecar, and creates the feed", async () => {
    const { note, readId } = await createImageNote("pics", PNG, { sender: "Ann", tags: ["a"], name: "cat.png" });
    expect(note).toBeInstanceOf(ImageNote);
    expect(note.file).toBe(`${note.id}.png`);
    expect(readId).toBeTruthy();
    expect(Array.from(await readFile(join(feedDir(), note.file)))).toEqual(Array.from(PNG));
    expect(JSON.parse(await readFile(join(feedDir(), `.${note.file}.json`), "utf8"))).toEqual({ sender: "Ann", tags: ["a"], name: "cat.png" });
    expect(note.size).toBe(PNG.length);
  });
  test("an unsupported type is refused and creates nothing", async () => {
    await expect(createImageNote("pics", new TextEncoder().encode("<svg/>"), {})).rejects.toBeInstanceOf(UnsupportedTypeError);
    await expect(stat(feedDir())).rejects.toThrow();
  });
  test("two images with the same bytes are two notes", async () => {
    const a = await createImageNote("pics", PNG, {});
    const b = await createImageNote("pics", PNG, {});
    expect(a.note.id).not.toBe(b.note.id);
  });
  test("it lists with markdown notes, reads back as an image, and has no title unless set", async () => {
    await createNote("pics", "# Text", new Date("2026-01-01T00:00:00Z"));
    const { note } = await createImageNote("pics", PNG, { alt: "a cat" }, new Date("2026-01-02T00:00:00Z"));
    const got = await getNote("pics", note.id);
    expect(got).toBeInstanceOf(ImageNote);
    expect(got).toMatchObject({ type: "image/png", alt: "a cat", title: "", file: note.file });
    expect((await listNotes("pics")).map((n) => n.type)).toEqual(["image/png", "text/markdown"]);
    expect((await createImageNote("pics", PNG, { title: "T" })).note.title).toBe("T");
  });
  test("hasImageNote is true for an image note's file only", async () => {
    const { note } = await createImageNote("pics", PNG, {});
    const { note: md } = await createNote("pics", "# x");
    expect(await hasImageNote("pics", note.file)).toBe(true);
    expect(await hasImageNote("pics", md.file)).toBe(false);
    expect(await hasImageNote("pics", "../x.png")).toBe(false);
    expect(await hasImageNote("pics", "nope.png")).toBe(false);
    await removeNote("pics", note.id);
    expect(await hasImageNote("pics", note.file)).toBe(false);
  });
  test("the image cap counts image notes, not markdown notes", async () => {
    process.env.NOTEFEED_MAX_IMAGES_PER_FEED = "2";
    await createNote("pics", "# x");
    await createImageNote("pics", png(1), {});
    await createImageNote("pics", png(2), {});
    const { countNotes } = await import("./notes");
    expect(await countNotes("pics", "image")).toBe(2);
    expect(await countNotes("pics", "markdown")).toBe(1);
    expect(await countNotes("pics")).toBe(3);
  });
  test("a note's files are in the feed folder", async () => {
    const { note } = await createImageNote("pics", JPG, {});
    expect((await readdir(feedDir())).filter((f) => !f.startsWith("."))).toEqual([`${note.id}.jpg`]);
  });
});
