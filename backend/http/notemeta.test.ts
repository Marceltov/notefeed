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
// A markdown note: the text is the body, its title and tags are headers.
const postJson = ({ markdown, title, tags }: { markdown: string; title?: string; tags?: string[] }) =>
  call("POST", "/feeds/f/notes", {
    body: markdown,
    headers: { "content-type": "text/markdown", ...(title !== undefined && { "x-note-title": encodeHeaderValue(title) }), ...(tags && { "x-note-tags": tags.join(",") }) },
  });
const getNote = async (id: string) => (await call("GET", `/feeds/f/notes/${id}`)).json();
const sidecar = async (file: string) => JSON.parse(await readFile(join(dir, "f", `.${file}.json`), "utf8"));
const postImage = (headers: Record<string, string> = {}) => call("POST", "/feeds/f/notes", { body: PNG, headers: { "content-type": "image/png", ...headers } });

describe("title and alt on a post", () => {
  test("a title is the markdown note's title, kept in the sidecar", async () => {
    const { id } = await (await postJson({ markdown: "# Derived\nbody", title: "  Set by hand " })).json();
    const note = await getNote(id);
    expect(note.title).toBe("Set by hand");
    expect(note.content).toBe("# Derived\nbody");
    expect(await sidecar(`${id}.md`)).toEqual({ title: "Set by hand" });
  });
  test("X-Note-Title on a raw markdown body", async () => {
    const res = await call("POST", "/feeds/f/notes", { body: "plain", headers: { "content-type": "text/markdown", "x-note-title": "Hdr" } });
    expect((await getNote((await res.json()).id)).title).toBe("Hdr");
  });
  test("an image's X-Note-Title and X-Note-Alt", async () => {
    const img = await (await postImage({ "x-note-title": "Cat", "x-note-alt": "a grey cat" })).json();
    const note = await getNote(img.id);
    expect(note).toMatchObject({ type: "image/png", title: "Cat", alt: "a grey cat", size: PNG.length });
  });
  test.each(["a\tb", "x".repeat(101)])("a bad title is 400 and nothing is written: %j", async (title) => {
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
    expect(note).toMatchObject({ type: "image/png", file: `${id}.png`, name: "cat.png", size: PNG.length });
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
    expect(list.notes.map((n: { type: string }) => n.type)).toEqual(["image/png", "text/markdown"]);
  });
});
