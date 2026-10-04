import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EmptyNoteError, ImageLimitError, ImageTooLargeError, InvalidBodyError, NotFoundError, UnsupportedTypeError } from "./errors";
import { protectedFeed } from "./feedlock";
import { hasFeed, resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";
import { logsOf } from "./log";
import * as notes from "./notes";
import { countNotes, createImageNote, createNote, getNote, MarkdownNote } from "./notes";
import { editWithPictures, MAX_ATTACHMENTS, type Picture, type PostBundle, postNote, postWithPictures } from "./posting";

// The text's write is the call after the pictures: a test makes it fail to see the pictures removed again.
vi.mock("./notes", async (original) => {
  const real = await original<typeof import("./notes")>();
  return { ...real, createNoteOf: vi.fn(real.createNoteOf), replaceContent: vi.fn(real.replaceContent), removeNote: vi.fn(real.removeNote) };
});

const real = await vi.importActual<typeof import("./notes")>("./notes");

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-posting-"));
  resetFeedsForTests();
  resetRateLimitsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "NOTEFEED_MAX_IMAGE_BYTES", "NOTEFEED_MAX_IMAGES_PER_FEED", "NOTEFEED_MAX_FEEDS"]) delete process.env[k];
});
afterEach(() => {
  vi.mocked(notes.createNoteOf).mockClear().mockImplementation(real.createNoteOf);
  vi.mocked(notes.removeNote).mockReset().mockImplementation(real.removeNote);
  vi.unstubAllEnvs();
});

const png = (n = 1) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n]);
const pic = (name: string, extra: Partial<Picture> = {}): Picture => ({ name, body: png(), mediaType: "image/png", ...extra });
const post = (bundle: PostBundle, feed = "f", access = {}) => postWithPictures(feed, "ip", async () => bundle, access, "Ann");
const edit = (id: string, b: { text: string; pictures: Picture[]; tags?: string[] }, feed = "f") => editWithPictures(feed, id, "ip", async () => b, {}, "Bob");
const markdownOf = async (id: string) => ((await getNote("f", id)) as MarkdownNote).markdown;

describe("postWithPictures", () => {
  test("with text undefined stores only the pictures", async () => {
    const r = await post({ pictures: [pic("a.png"), pic("b.png")], title: "Holiday", tags: ["trip"] });
    expect(r.note).toBe(r.pictures[0]);
    expect(r.pictures.map((p) => [p.title, p.tags, p.sender])).toEqual([["Holiday", ["trip"], "Ann"], ["Holiday", ["trip"], "Ann"]]);
    expect(await countNotes("f", "markdown")).toBe(0);
    expect(await countNotes("f", "image")).toBe(2);
  });

  test("with no pictures it stores the same note as postNote", async () => {
    const r = await post({ text: "# Hi\n\nthere", pictures: [], title: "T", tags: ["x"] });
    const p = await postNote("g", "ip", async () => ({ body: new TextEncoder().encode("# Hi\n\nthere"), mediaType: "text/markdown", title: "T", tags: ["x"] }), {}, "Ann");
    expect(r.pictures).toEqual([]);
    const strip = (n: notes.Note) => ({ ...n.meta, md: (n as MarkdownNote).markdown, type: n.type });
    expect(strip(r.note)).toEqual(strip(p.note));
    expect([r.created, typeof r.readId]).toEqual([p.created, typeof p.readId]);
  });

  test("with neither text nor pictures it is an InvalidBodyError", async () => {
    await expect(post({ pictures: [] })).rejects.toBeInstanceOf(InvalidBodyError);
    expect(await hasFeed("f")).toBe(false);
  });

  test("stores the pictures then the text, in order, with the references swapped and unreferenced ones appended", async () => {
    const r = await post({ text: "See ![cat](a.png) and ![](<b c.png>)", pictures: [pic("b c.png"), pic("a.png", { alt: "A cat" }), pic("d.png")], title: "T", tags: ["t"] });
    const [b, a, d] = r.pictures;
    expect(r.pictures.map((p) => p.meta.name)).toEqual(["b c.png", "a.png", "d.png"]);
    expect(a.alt).toBe("A cat");
    expect(await markdownOf(r.note.id)).toBe(`See ![cat](${a.file}) and ![](${b.file})\n\n![](${d.file})`);
    expect(r.note.title).toBe("T");
    expect(r.pictures.every((p) => p.meta.title === undefined)).toBe(true);
    expect([r.note, ...r.pictures].every((n) => n.tags.join() === "t")).toBe(true);
    // Stored in that order: the pictures first, the text last (ids made in one millisecond do not sort, so the calls tell).
    expect(vi.mocked(notes.createNoteOf).mock.calls.map((c) => c[4]?.name ?? c[1].name)).toEqual(["b c.png", "a.png", "d.png", "markdown"]);
  });

  test("a blank text with pictures is the pictures", async () => {
    const r = await post({ text: "", pictures: [pic("a.png")] });
    expect(await markdownOf(r.note.id)).toBe(`![](${r.pictures[0].file})`);
  });

  const refused: [string, PostBundle, unknown, string?][] = [
    ["a duplicate filename", { text: "x", pictures: [pic("a.png"), pic("a.png")] }, InvalidBodyError, "a.png"],
    ["an unsafe filename", { text: "x", pictures: [pic("a/b.png")] }, InvalidBodyError, "a\ufffdb.png"], // the echo is safeName's: a forbidden character as U+FFFD
    ["a non-image mediaType", { text: "x", pictures: [pic("a.md", { mediaType: "text/markdown" })] }, UnsupportedTypeError, "a.md"],
    ["bytes that are not that image", { text: "x", pictures: [pic("a.jpg", { mediaType: "image/jpeg" })] }, UnsupportedTypeError, "a.jpg"],
    ["an oversized picture", { text: "x", pictures: [pic("a.png"), pic("big.png", { body: new Uint8Array([...png(), ...new Uint8Array(100)]) })] }, ImageTooLargeError, "big.png"],
    ["a bad alt", { text: "x", pictures: [pic("a.png", { alt: "a\nb" })] }, InvalidBodyError, "a.png"],
    ["more than MAX_ATTACHMENTS pictures", { text: "x", pictures: Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => pic(`${i}.png`)) }, InvalidBodyError],
    ["a blank text with no pictures", { text: " \n", pictures: [] }, EmptyNoteError],
    ["a bad title", { text: "x", pictures: [pic("a.png")], title: "a\nb" }, InvalidBodyError],
    ["a bad tag", { text: "x", pictures: [pic("a.png")], tags: ["no spaces"] }, InvalidBodyError],
  ];
  test.each(refused)("refuses %s with nothing stored and no feed created", async (_, bundle, error, name) => {
    vi.stubEnv("NOTEFEED_MAX_IMAGE_BYTES", "50");
    const e = await post(bundle).catch((e: Error) => e);
    expect(e).toBeInstanceOf(error as typeof Error);
    if (name) expect((e as Error).message).toMatch(new RegExp(`^attachment "${name}": `));
    else expect((e as Error).message).not.toMatch(/^attachment/);
    expect(await hasFeed("f")).toBe(false);
  });

  test("a refused name is echoed without its control and text-direction characters", async () => {
    const e = (await post({ text: "x", pictures: [pic("a.png"), pic("evil\u202egnp\u009b[31m.exe")] }).catch((e: Error) => e)) as Error;
    expect(e).toBeInstanceOf(InvalidBodyError);
    expect(e.message).toMatch(/^attachment "evil\ufffdgnp\ufffd\[31m\.exe": not a file name/);
    expect(e.message).toContain("not only dots");
    expect(e.message).not.toMatch(/[\u009b\u202e]/);
    expect(await hasFeed("f")).toBe(false);
  });

  test("refuses the image cap for existing plus new, with nothing stored", async () => {
    vi.stubEnv("NOTEFEED_MAX_IMAGES_PER_FEED", "3");
    await createImageNote("f", png(), {});
    await createImageNote("f", png(), {});
    await expect(post({ text: "x", pictures: [pic("a.png"), pic("b.png")] })).rejects.toBeInstanceOf(ImageLimitError);
    expect(await countNotes("f")).toBe(2);
    await post({ text: "x", pictures: [pic("a.png")] });
    expect(await countNotes("f", "image")).toBe(3);
  });

  test("the image cap holds for a feed that does not exist yet: nothing stored, no feed", async () => {
    vi.stubEnv("NOTEFEED_MAX_IMAGES_PER_FEED", "2");
    await expect(post({ text: "x", pictures: [pic("a.png"), pic("b.png"), pic("c.png")] })).rejects.toBeInstanceOf(ImageLimitError);
    expect(await hasFeed("f")).toBe(false);
    await post({ text: "x", pictures: [pic("a.png"), pic("b.png")] });
    expect(await countNotes("f", "image")).toBe(2);
  });

  test("a new protected feed with a bad second picture is not created", async () => {
    await expect(post({ text: "x", pictures: [pic("a.png"), pic("b.png", { mediaType: "image/gif" })] }, "f", { password: "secret-password" })).rejects.toThrow(/^attachment "b.png": /);
    expect(await hasFeed("f")).toBe(false);
    expect(await protectedFeed("f")).toBe(false);
  });

  test("a failure while storing removes the pictures already stored", async () => {
    const boom = new Error("disk full");
    vi.mocked(notes.createNoteOf).mockImplementation(async (...args) => {
      if (args[1].name === "markdown") throw boom;
      return real.createNoteOf(...args);
    });
    await expect(post({ text: "x ![](a.png)", pictures: [pic("a.png"), pic("b.png")] })).rejects.toBe(boom);
    expect(vi.mocked(notes.createNoteOf)).toHaveBeenCalledTimes(3);
    expect(await countNotes("f")).toBe(0);
  });

  test("a failure while storing the second picture removes the first and rethrows that error", async () => {
    const boom = new Error("disk full");
    vi.mocked(notes.createNoteOf).mockImplementation(async (...args) => {
      if (args[4]?.name === "b.png") throw boom;
      return real.createNoteOf(...args);
    });
    await expect(post({ text: "x", pictures: [pic("a.png"), pic("b.png"), pic("c.png")] })).rejects.toBe(boom);
    expect(vi.mocked(notes.createNoteOf)).toHaveBeenCalledTimes(2); // a.png stored, b.png failed: c.png and the text never tried
    const first = (await vi.mocked(notes.createNoteOf).mock.results[0].value).note.id;
    expect(vi.mocked(notes.removeNote).mock.calls).toEqual([["f", first]]);
    expect(await countNotes("f")).toBe(0);
  });

  test("a picture that can't be removed again is logged by its note id, never the feed's name, and the first error is rethrown", async () => {
    const boom = new Error("disk full");
    vi.mocked(notes.createNoteOf).mockImplementation(async (...args) => {
      if (args[1].name === "markdown") throw boom;
      return real.createNoteOf(...args);
    });
    vi.mocked(notes.removeNote).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("EACCES"));
    const logs = await logsOf(() => expect(post({ text: "x", pictures: [pic("a.png"), pic("b.png"), pic("c.png")] }, "hidden-feed")).rejects.toBe(boom));
    const ids = (await Promise.all(vi.mocked(notes.createNoteOf).mock.results.slice(0, 2).map((r) => r.value))).map((m) => m.note.id);
    const lines = logs.filter((l) => l.msg === "a picture of a failed post could not be removed");
    expect(lines.map((l) => [l.level, l.component, l.note])).toEqual(ids.map((id) => ["error", "posting", id]));
    expect((lines[1].err as { message: string }).message).toBe("EACCES");
    expect(JSON.stringify(logs)).not.toContain("hidden-feed");
    expect(await countNotes("hidden-feed")).toBe(2); // the third was removed
  });

  test("the rate limit counts once for N pictures", async () => {
    vi.stubEnv("NOTEFEED_RATE_LIMIT", "2");
    await post({ text: "x", pictures: [pic("a.png"), pic("b.png"), pic("c.png")] });
    await post({ pictures: [pic("a.png"), pic("b.png"), pic("c.png")] });
    expect(await countNotes("f")).toBe(7);
  });
});

describe("editWithPictures", () => {
  test("replaces a markdown note's text and stores the pictures, keeping id, title and sender", async () => {
    const { note } = await createNote("f", "old", undefined, "Ann", ["keep"], undefined, "Title");
    const r = await edit(note.id, { text: "new ![x](a.png)", pictures: [pic("a.png", { alt: "alt" })], tags: ["t"] });
    expect(r.note.id).toBe(note.id);
    expect([r.note.title, r.note.sender, r.note.tags]).toEqual(["Title", "Ann", ["keep"]]);
    expect(await markdownOf(note.id)).toBe(`new ![x](${r.pictures[0].file})`);
    expect([r.pictures[0].sender, r.pictures[0].tags, r.pictures[0].alt, r.pictures[0].meta.name]).toEqual(["Bob", ["t"], "alt", "a.png"]);
  });

  test("NotFoundError for a missing note, with nothing stored", async () => {
    await createNote("f", "x");
    await expect(edit("nope", { text: "y", pictures: [pic("a.png")] })).rejects.toBeInstanceOf(NotFoundError);
    expect(await countNotes("f")).toBe(1);
  });

  test("UnsupportedTypeError for an image note, with nothing stored", async () => {
    const { note } = await createImageNote("f", png(), {});
    await expect(edit(note.id, { text: "y", pictures: [pic("a.png")] })).rejects.toBeInstanceOf(UnsupportedTypeError);
    expect(await countNotes("f")).toBe(1);
  });

  test("a picture's error names it, with nothing stored", async () => {
    const { note } = await createNote("f", "x");
    await expect(edit(note.id, { text: "y", pictures: [pic("a.png"), pic("a.png")] })).rejects.toThrow(/^attachment "a.png": /);
    expect(await countNotes("f")).toBe(1);
  });

  test("a failure while storing the text removes the pictures and keeps the old text", async () => {
    const { note } = await createNote("f", "old");
    const boom = new Error("disk full");
    vi.mocked(notes.replaceContent).mockRejectedValueOnce(boom);
    await expect(edit(note.id, { text: "new", pictures: [pic("a.png"), pic("b.png")] })).rejects.toBe(boom);
    expect(await countNotes("f")).toBe(1);
    expect(await markdownOf(note.id)).toBe("old");
  });
});
