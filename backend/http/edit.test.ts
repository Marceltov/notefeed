import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { encodeHeaderValue } from "../../shared/headers";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { API_PREFIX, dispatch } from "./api";

const BASE = "http://localhost:3000";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-edit-"));
  process.env.DATA_DIR = dir;
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL", "NOTEFEED_MAX_IMAGE_BYTES"]) delete process.env[k];
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9, 9]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

function send(method: string, path: string, body: BodyInit | null, type: string | null, headers: Record<string, string> = {}) {
  const h = new Headers({ host: "localhost:3000", ...headers });
  if (type !== null) h.set("content-type", type);
  const url = new URL(API_PREFIX + path, BASE);
  return dispatch(new Request(url, { method, body, headers: h }), url.pathname.slice(API_PREFIX.length + 1).split("/"));
}
const post = async (body: BodyInit, type: string, headers: Record<string, string> = {}) => (await send("POST", "/feeds/f/notes", body, type, headers)).json();
const put = (id: string, body: BodyInit | null, type: string | null) => send("PUT", `/feeds/f/notes/${id}`, body, type);
const patch = (id: string, body: unknown, type: string | null = "application/json") => send("PATCH", `/feeds/f/notes/${id}`, typeof body === "string" ? body : JSON.stringify(body), type);
const get = async (id: string) => (await send("GET", `/feeds/f/notes/${id}`, null, null)).json();
const sidecar = async (file: string) => JSON.parse(await readFile(join(dir, "f", `.${file}.json`), "utf8"));
const content = (file: string) => readFile(join(dir, "f", file));

describe("PUT replaces the content", () => {
  test("a markdown note gets the new text byte for byte and keeps its id, date and metadata", async () => {
    const made = await post("# Old", "text/markdown", { "x-note-title": "Kept", "x-note-tags": "a" });
    const res = await put(made.id, "# New\r\nbody", "text/markdown; charset=utf-8");
    expect(res.status).toBe(200);
    const note = await res.json();
    expect(note).toMatchObject({ id: made.id, type: "text/markdown", content: "# New\r\nbody", title: "Kept", tags: ["a"] });
    expect((await content(made.file)).toString()).toBe("# New\r\nbody");
  });
  test("a picture is replaced by another of its type", async () => {
    const made = await post(PNG as BodyInit, "image/png", { "x-note-alt": "a cat" });
    const res = await put(made.id, PNG2 as BodyInit, "image/png");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: made.id, size: PNG2.length, alt: "a cat" });
    expect([...(await content(made.file))]).toEqual([...PNG2]);
  });
  test("a note keeps its type: another type is 415 and changes nothing", async () => {
    const md = await post("# Text", "text/markdown");
    const png = await post(PNG as BodyInit, "image/png");
    for (const [id, body, type] of [
      [md.id, PNG, "image/png"],
      [png.id, "# text", "text/markdown"],
      [png.id, JPG, "image/jpeg"],
    ] as [string, BodyInit, string][]) {
      const res = await put(id, body, type);
      expect(res.status, type).toBe(415);
    }
    expect((await content(md.file)).toString()).toBe("# Text");
    expect([...(await content(png.file))]).toEqual([...PNG]);
  });
  test("the same checks as a post: a blank body is 400, a wrong signature or bad UTF-8 is 415, an oversize body is 413", async () => {
    const md = await post("# Text", "text/markdown");
    const png = await post(PNG as BodyInit, "image/png");
    expect((await put(md.id, "  ", "text/markdown")).status).toBe(400);
    expect((await put(md.id, new Uint8Array([0xff, 0xfe]) as BodyInit, "text/markdown")).status).toBe(415);
    expect((await put(png.id, "<html></html>", "image/png")).status).toBe(415);
    expect((await put(md.id, "a".repeat(102401), "text/markdown")).status).toBe(413);
    process.env.NOTEFEED_MAX_IMAGE_BYTES = "20";
    expect((await put(png.id, new Uint8Array([...PNG, ...new Uint8Array(20)]) as BodyInit, "image/png")).status).toBe(413);
    expect((await content(md.file)).toString()).toBe("# Text");
  });
  test("no Content-Type, text/plain or JSON is 415; a missing note is 404", async () => {
    const md = await post("# Text", "text/markdown");
    for (const type of [null, "text/plain", "application/json"]) expect((await put(md.id, "# x", type)).status).toBe(415);
    expect((await put("nope", "# x", "text/markdown")).status).toBe(404);
  });
});

describe("PATCH changes metadata", () => {
  test("a title on a markdown note: the title follows it, the text is untouched", async () => {
    const made = await post("# Old\nbody", "text/markdown");
    const res = await patch(made.id, { title: "  Set " });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "Set", content: "# Old\nbody" });
    expect(await sidecar(made.file)).toEqual({ title: "Set" });
  });
  test("an empty title removes it, the title follows the text again, and no empty sidecar is left", async () => {
    const made = await post("# Old", "text/markdown", { "x-note-title": "Set" });
    expect((await (await patch(made.id, { title: "" })).json()).title).toBe("Old");
    await expect(readFile(join(dir, "f", `.${made.file}.json`))).rejects.toThrow();
  });
  test("title and alt on a picture", async () => {
    const made = await post(PNG as BodyInit, "image/png");
    const res = await patch(made.id, { title: "Cat", alt: "a cat" });
    expect(await res.json()).toMatchObject({ type: "image/png", title: "Cat", alt: "a cat" });
    expect(await sidecar(made.file)).toEqual({ title: "Cat", alt: "a cat" });
    expect((await (await patch(made.id, { alt: "" })).json()).alt).toBeUndefined();
  });
  test("metadata not in the patch stays: sender, tags, name", async () => {
    const made = await post(PNG as BodyInit, "image/png", { "x-note-tags": "pets", "x-note-name": encodeHeaderValue("Größe.png") });
    await patch(made.id, { title: "T" });
    expect(await sidecar(made.file)).toEqual({ title: "T", tags: ["pets"], name: "Größe.png" });
  });
  test("alt on a markdown note, an empty patch, a bad title or bad JSON is 400; a wrong Content-Type is 415; a missing note is 404", async () => {
    const md = await post("# x", "text/markdown");
    expect((await patch(md.id, { alt: "no" })).status).toBe(400);
    expect((await patch(md.id, {})).status).toBe(400);
    expect((await patch(md.id, { title: "x".repeat(101) })).status).toBe(400);
    expect((await patch(md.id, { title: "a\nb" })).status).toBe(400);
    for (const title of ["a\u009bb", "a\u202eb", "a\u2028b"]) expect((await patch(md.id, { title })).status, JSON.stringify(title)).toBe(400);
    expect((await patch(md.id, "{nope")).status).toBe(400);
    expect((await patch(md.id, { title: "x" }, "text/plain")).status).toBe(415);
    expect((await patch("nope", { title: "x" })).status).toBe(404);
    expect((await get(md.id)).title).toBe("x");
  });
});

test("a read link can neither put nor patch", async () => {
  const made = await post("# x", "text/markdown");
  const res = await send("PUT", `/read/anything/notes/${made.id}`, "# y", "text/markdown");
  expect([404, 405]).toContain(res.status);
});

describe("multipart PUT: a markdown note's new text with its pictures", () => {
  const png = (name: string, bytes: Uint8Array = PNG) => new File([bytes as BlobPart], name, { type: "image/png" });
  const putForm = (id: string, parts: [string, string | File][], headers: Record<string, string> = {}) => {
    const f = new FormData();
    for (const [k, v] of parts) f.append(k, v);
    return send("PUT", `/feeds/f/notes/${id}`, f, null, headers);
  };
  const pictures = async () => (await readdir(join(dir, "f"))).filter((n) => n.endsWith(".png"));

  test("200: the note with its new text and the pictures; the tags go on the pictures, the note keeps its own", async () => {
    const made = await post("# Old", "text/markdown", { "x-note-title": "Kept", "x-note-tags": "a" });
    const res = await putForm(made.id, [["text", "# New ![](c.png)"], ["file", png("c.png")], ["alt.c.png", "C"]], { "x-note-tags": "pics" });
    expect(res.status).toBe(200);
    const note = await res.json();
    expect(note.attachments).toHaveLength(1);
    const [c] = note.attachments;
    expect(c.file).toBe(`${c.id}.png`);
    expect(note).toMatchObject({ id: made.id, type: "text/markdown", content: `# New ![](${c.file})`, title: "Kept", tags: ["a"] });
    expect(await sidecar(c.file)).toEqual({ alt: "C", name: "c.png", tags: ["pics"] });
    expect((await content(made.file)).toString()).toBe(`# New ![](${c.file})`);
  });
  test("the text as a file part works the same, byte for byte", async () => {
    const made = await post("# Old", "text/markdown");
    const res = await putForm(made.id, [["text", new File(["# New\nline"], "n.md", { type: "text/markdown" })]]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ content: "# New\nline", attachments: [] });
    expect((await putForm(made.id, [["text", new File(["# x"], "n.md", { type: "image/png" })]])).status).toBe(415);
  });
  test("a raw PUT's answer has no attachments", async () => {
    const made = await post("# Old", "text/markdown");
    expect("attachments" in (await (await put(made.id, "# New", "text/markdown")).json())).toBe(false);
  });
  test("a missing note is 404, an image note 415, no text part 400, a bad picture 415: nothing is stored or changed", async () => {
    const md = await post("# Text", "text/markdown");
    const img = await post(PNG as BodyInit, "image/png");
    expect((await putForm("nope", [["text", "# x"], ["file", png("a.png")]])).status).toBe(404);
    expect((await putForm(img.id, [["text", "# x"], ["file", png("a.png")]])).status).toBe(415);
    expect((await putForm(md.id, [["file", png("a.png")]])).status).toBe(400);
    expect((await putForm(md.id, [["text", "# x"], ["other", "y"]])).status).toBe(400);
    expect((await putForm(md.id, [["text", "# x"], ["file", png("a.png")]], { "x-note-alt": "y" })).status).toBe(400);
    expect((await putForm(md.id, [["text", "# x"], ["file", png("a.png")], ["file", png("b.png", JPG)]])).status).toBe(415);
    expect(await pictures()).toEqual([img.file]);
    expect((await content(md.file)).toString()).toBe("# Text");
  });
});
