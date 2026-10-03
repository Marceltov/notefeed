import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { encodeHeaderValue } from "../../shared/headers";
import { readIdOf, resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { API_PREFIX, dispatch } from "./api";

const BASE = "http://localhost:3000";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-meta-"));
  process.env.DATA_DIR = dir;
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL", "NOTEFEED_MAX_IMAGE_BYTES"]) delete process.env[k];
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function call(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
  const url = new URL(API_PREFIX + path, BASE);
  const segments = url.pathname.slice(API_PREFIX.length + 1).split("/").map(decodeURIComponent);
  return dispatch(new Request(url, { method, body: init.body, headers: { host: "localhost:3000", ...init.headers } }), segments);
}
const postJson = (body: object) => call("POST", "/feeds/f/notes", { body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const putJson = (id: string, body: object) => call("PUT", `/feeds/f/notes/${id}`, { body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const getNote = async (id: string) => (await call("GET", `/feeds/f/notes/${id}`)).json();
const sidecar = async (file: string) => JSON.parse(await readFile(join(dir, "f", `.${file}.json`), "utf8"));
const postImage = (headers: Record<string, string> = {}) => call("POST", "/feeds/f/notes", { body: PNG, headers: { "content-type": "image/png", ...headers } });

describe("title and alt on a post", () => {
  test("a JSON title is the markdown note's title, kept in the sidecar", async () => {
    const { id } = await (await postJson({ markdown: "# Derived\nbody", title: "  Set by hand " })).json();
    const note = await getNote(id);
    expect(note.title).toBe("Set by hand");
    expect(note.markdown).toBe("# Derived\nbody");
    expect(await sidecar(`${id}.md`)).toEqual({ title: "Set by hand" });
  });
  test("X-Note-Title on a raw markdown body", async () => {
    const res = await call("POST", "/feeds/f/notes", { body: "plain", headers: { "content-type": "text/plain", "x-note-title": "Hdr" } });
    expect((await getNote((await res.json()).id)).title).toBe("Hdr");
  });
  test("a form title and an image's X-Note-Title and X-Note-Alt", async () => {
    const f = new FormData();
    f.set("markdown", "x");
    f.set("title", "From a form");
    expect((await getNote((await (await call("POST", "/feeds/f/notes", { body: f })).json()).id)).title).toBe("From a form");
    const img = await (await postImage({ "x-note-title": "Cat", "x-note-alt": "a grey cat" })).json();
    const note = await getNote(img.id);
    expect(note).toMatchObject({ kind: "image", title: "Cat", alt: "a grey cat", markdown: "", size: PNG.length });
  });
  test.each(["a\nb", "x".repeat(101)])("a bad title is 400 and nothing is written: %j", async (title) => {
    const res = await postJson({ markdown: "x", title });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
    await expect(readIdOf("f")).resolves.toBeNull();
  });
});

describe("an image note over the API", () => {
  test("GET shows kind, file, an absolute file_url under the read id, size and the original name", async () => {
    const { id } = await (await postImage({ "x-note-name": "cat.png" })).json();
    const note = await getNote(id);
    expect(note).toMatchObject({ kind: "image", file: `${id}.png`, name: "cat.png", size: PNG.length, markdown: "" });
    expect(note.file_url).toBe(`${BASE}/r/${(await readIdOf("f"))!}/${id}.png`);
    const rid = (await readIdOf("f"))!;
    const viaRead = await (await call("GET", `/read/${rid}/notes/${id}`)).json();
    expect(viaRead.file_url).toBe(note.file_url);
    expect(viaRead.url).toBe(`${BASE}/r/${rid}/${id}`);
  });
  test("the list has both kinds", async () => {
    await postJson({ markdown: "# Text" });
    await postImage();
    const list = await (await call("GET", "/feeds/f/notes")).json();
    expect(list.notes.map((n: { kind: string }) => n.kind)).toEqual(["image", "markdown"]);
  });
});

describe("editing", () => {
  test("a JSON edit may change only the title, and keeps the markdown", async () => {
    const { id } = await (await postJson({ markdown: "# Old\nbody" })).json();
    const res = await putJson(id, { title: "New title" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "New title", markdown: "# Old\nbody" });
  });
  test("an empty title removes it: the title follows the text again", async () => {
    const { id } = await (await postJson({ markdown: "# Old", title: "Set" })).json();
    expect((await (await putJson(id, { title: "" })).json()).title).toBe("Old");
    await expect(readFile(join(dir, "f", `.${id}.md.json`), "utf8")).rejects.toThrow(); // no empty sidecar left
  });
  test("an edit with markdown keeps the sender and tags in the sidecar", async () => {
    const res = await call("POST", "/feeds/f/notes", { body: JSON.stringify({ markdown: "a", tags: ["x"] }), headers: { "content-type": "application/json" } });
    const { id } = await res.json();
    await putJson(id, { markdown: "b", title: "T" });
    expect(await sidecar(`${id}.md`)).toEqual({ title: "T", tags: ["x"] });
  });
  test("a raw markdown body still edits as before", async () => {
    const { id } = await (await postJson({ markdown: "a" })).json();
    const res = await call("PUT", `/feeds/f/notes/${id}`, { body: "# new", headers: { "content-type": "text/markdown" } });
    expect((await res.json()).markdown).toBe("# new");
  });
  test("an image note takes a title and alt, but not markdown", async () => {
    const { id } = await (await postImage()).json();
    const res = await putJson(id, { title: "Cat", alt: "a cat" });
    expect(await res.json()).toMatchObject({ kind: "image", title: "Cat", alt: "a cat" });
    const bad = await putJson(id, { markdown: "text" });
    expect(bad.status).toBe(400);
    expect((await getNote(id)).kind).toBe("image");
  });
  test("an edit with nothing to change is 400; a missing note is 404", async () => {
    const { id } = await (await postJson({ markdown: "a" })).json();
    expect((await putJson(id, {})).status).toBe(400);
    expect((await putJson("nope", { title: "x" })).status).toBe(404);
  });
  test("a blank markdown edit is still refused", async () => {
    const { id } = await (await postJson({ markdown: "a" })).json();
    expect((await putJson(id, { markdown: "  " })).status).toBe(400);
  });
});

describe("POST /feeds/{feed}/images: the typed way to post a picture", () => {
  const postTo = (type: string, headers: Record<string, string> = {}, body: BodyInit = PNG) => call("POST", "/feeds/f/images", { body, headers: { "content-type": type, ...headers } });
  test("creates an image note and answers like a post, with the file and its URL", async () => {
    const res = await postTo("image/png", { "x-note-name": "cat.png", "x-note-title": "Cat", "x-note-alt": "a cat", "x-note-tags": "pets" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.file).toBe(`${body.id}.png`);
    expect(body.file_url).toBe(`${BASE}/r/${(await readIdOf("f"))!}/${body.file}`);
    expect(await getNote(body.id)).toMatchObject({ kind: "image", title: "Cat", alt: "a cat", name: "cat.png", tags: ["pets"] });
  });
  test("a feed password header makes the post that creates the feed protected", async () => {
    expect((await postTo("image/png", { "x-feed-password": "hunter22" })).status).toBe(201);
    expect((await postTo("image/png")).status).toBe(401);
  });
  test("only a picture: markdown here is 415", async () => {
    const res = await postTo("text/markdown", {}, "# not a picture");
    expect(res.status).toBe(415);
    await expect(readIdOf("f")).resolves.toBeNull();
  });
  test("the bytes decide: HTML sent as image/png is 415", async () => {
    expect((await postTo("image/png", {}, "<html></html>")).status).toBe(415);
  });
});

describe("non-ASCII text in image headers", () => {
  test("title, alt and name arrive as the UTF-8 they were sent as (curl, or a client that encodes them)", async () => {
    const res = await postImage({ "x-note-title": encodeHeaderValue("Café 日本語"), "x-note-alt": encodeHeaderValue("Größe"), "x-note-name": encodeHeaderValue("Größe.png") });
    const note = await getNote((await res.json()).id);
    expect(note).toMatchObject({ title: "Café 日本語", alt: "Größe", name: "Größe.png" });
  });
  test("the same through the typed /images endpoint and for a markdown note's title header", async () => {
    const img = await call("POST", "/feeds/f/images", { body: PNG, headers: { "content-type": "image/png", "x-note-title": encodeHeaderValue("Ünï") } });
    expect((await getNote((await img.json()).id)).title).toBe("Ünï");
    const md = await call("POST", "/feeds/f/notes", { body: "x", headers: { "content-type": "text/plain", "x-note-title": encodeHeaderValue("Ünï") } });
    expect((await getNote((await md.json()).id)).title).toBe("Ünï");
  });
});
