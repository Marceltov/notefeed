import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { deleteNoteFile, listNoteFiles, readNote, replaceNote, writeNote } from "./notes";

let dir: string;
beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "notefeed-"));
  process.env.DATA_DIR = root;
  dir = join(root, "f");
  await mkdir(dir);
});
const files = async () => (await readdir(dir)).sort();

describe("writeNote", () => {
  test("stores the content byte for byte, with no front matter", async () => {
    const id = await writeNote("f", "a", "md", "# T\r\nx", { sender: "Ann" });
    expect(await readFile(join(dir, `${id}.md`), "utf8")).toBe("# T\r\nx");
  });
  test("writes the metadata as .<id>.<ext>.json", async () => {
    const id = await writeNote("f", "a", "md", "x", { sender: "Ann", tags: ["ci"] });
    expect(JSON.parse(await readFile(join(dir, `.${id}.md.json`), "utf8"))).toEqual({ sender: "Ann", tags: ["ci"] });
  });
  test("writes no sidecar for empty metadata", async () => {
    const id = await writeNote("f", "a", "md", "x", {});
    expect(await files()).toEqual([`${id}.md`]);
  });
  test("a taken id gets -2, -3 and never overwrites", async () => {
    await writeFile(join(dir, "a.md"), "hand");
    expect(await writeNote("f", "a", "md", "x", { sender: "S" })).toBe("a-2");
    expect(await writeNote("f", "a", "md", "y", {})).toBe("a-3");
    expect(await readFile(join(dir, "a.md"), "utf8")).toBe("hand");
  });
  test("stores binary content", async () => {
    const id = await writeNote("f", "a", "png", new Uint8Array([0x89, 1, 2]), {});
    expect([...(await readFile(join(dir, `${id}.png`)))]).toEqual([0x89, 1, 2]);
  });
});

describe("readNote and listNoteFiles", () => {
  test("reads content, meta and mtime", async () => {
    const id = await writeNote("f", "a", "md", "x", { title: "T" });
    const n = await readNote("f", id);
    expect(n?.ext).toBe("md");
    expect(n?.content.toString()).toBe("x");
    expect(n?.meta).toEqual({ title: "T" });
    expect(n?.mtime).toBeInstanceOf(Date);
  });
  test("a sidecar with invalid JSON reads as empty meta", async () => {
    await writeFile(join(dir, "h.md"), "x");
    await writeFile(join(dir, ".h.md.json"), "{nope");
    expect((await readNote("f", "h"))?.meta).toEqual({});
  });
  test("fields of the wrong type are dropped", async () => {
    await writeFile(join(dir, "h.md"), "x");
    await writeFile(join(dir, ".h.md.json"), JSON.stringify({ title: 5, sender: "S", tags: ["a", 1] }));
    expect((await readNote("f", "h"))?.meta).toEqual({ sender: "S", tags: ["a"] });
  });
  test("a note without a sidecar has empty meta", async () => {
    await writeFile(join(dir, "h.md"), "x");
    expect((await readNote("f", "h"))?.meta).toEqual({});
  });
  test("a sidecar without content is not listed and not a note", async () => {
    await writeFile(join(dir, ".o.md.json"), "{}");
    expect(await listNoteFiles("f")).toEqual([]);
    expect(await readNote("f", "o")).toBeNull();
  });
  test("dot files and names with several dots are never listed", async () => {
    await writeFile(join(dir, ".readid"), "x");
    await writeFile(join(dir, ".t.tmp"), "x");
    await writeFile(join(dir, "a.b.md"), "x");
    await writeFile(join(dir, "ok.md"), "x");
    expect(await listNoteFiles("f")).toEqual([{ id: "ok", ext: "md" }]);
  });
  test("a missing note and a missing feed read as null / empty", async () => {
    expect(await readNote("f", "nope")).toBeNull();
    expect(await listNoteFiles("missing")).toEqual([]);
  });
});

describe("replaceNote and deleteNoteFile", () => {
  test("replace changes the content and leaves the sidecar", async () => {
    const id = await writeNote("f", "a", "md", "old", { sender: "S" });
    expect(await replaceNote("f", id, "new")).toBe(true);
    const n = await readNote("f", id);
    expect(n?.content.toString()).toBe("new");
    expect(n?.meta).toEqual({ sender: "S" });
  });
  test("replace of a missing note is false and creates nothing", async () => {
    expect(await replaceNote("f", "nope", "x")).toBe(false);
    expect(await files()).toEqual([]);
  });
  test("delete removes content and sidecar", async () => {
    const id = await writeNote("f", "a", "md", "x", { sender: "S" });
    expect(await deleteNoteFile("f", id)).toBe(true);
    expect(await files()).toEqual([]);
    expect(await deleteNoteFile("f", id)).toBe(false);
  });
});
