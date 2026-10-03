import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { encodeHeaderValue } from "../../shared/headers";
import { protectedFeed } from "../feedlock";
import { hasFeed, readIdOf, resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { API_PREFIX, dispatch } from "./api";

const BASE = "http://localhost:3000";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-post-"));
  process.env.DATA_DIR = dir;
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL", "NOTEFEED_MAX_IMAGE_BYTES", "NOTEFEED_MAX_IMAGES_PER_FEED", "NOTEFEED_MAX_NOTES_PER_FEED"]) delete process.env[k];
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF = new TextEncoder().encode("GIF89a\x01\x00");
const WEBP = new TextEncoder().encode("RIFF\x10\x00\x00\x00WEBPVP8 ");

// POST /feeds/<feed>/notes: the body is the file, Content-Type says what it is.
function post(body: BodyInit | null, type: string | null, headers: Record<string, string> = {}, feed = "f") {
  const h = new Headers({ host: "localhost:3000", ...headers });
  if (type !== null) h.set("content-type", type);
  return dispatch(new Request(`${BASE}${API_PREFIX}/feeds/${feed}/notes`, { method: "POST", body, headers: h }), ["feeds", feed, "notes"]);
}
const stored = (file: string) => readFile(join(dir, "f", file));

describe("a markdown note", () => {
  test("201: the file is the body byte for byte, and the answer names the file and where it is served", async () => {
    const res = await post("# Hi\r\nthere", "text/markdown");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.file).toBe(`${body.id}.md`);
    expect(body.file_url).toBe(`${BASE}/r/${(await readIdOf("f"))!}/${body.file}`);
    expect(body.url).toBe(`${BASE}/f/${body.id}`);
    expect((await stored(body.file)).toString()).toBe("# Hi\r\nthere");
  });
  test("charset=utf-8 and any case of the type are fine", async () => {
    expect((await post("# a", "text/markdown; charset=utf-8")).status).toBe(201);
    expect((await post("# b", "TEXT/Markdown")).status).toBe(201);
  });
  test("a BOM and non-ASCII text are kept as sent", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("# Café 日本語")]);
    const { file } = await (await post(bytes, "text/markdown")).json();
    expect([...(await stored(file))]).toEqual([...bytes]);
  });
});

describe("every other Content-Type is refused, and nothing is created", () => {
  test.each([null, "text/plain", "application/x-www-form-urlencoded", "application/octet-stream", "application/json", "multipart/form-data; boundary=x", "image/svg+xml", "text/markdown; charset=iso-8859-1"])(
    "%j is 415 and the message names the types to send",
    async (type) => {
      const res = await post("# Hi", type);
      expect(res.status).toBe(415);
      const body = await res.json();
      expect(body.code).toBe("unsupported_type");
      expect(body.error).toContain("text/markdown");
      expect(body.error).toContain("image/png");
      expect(await hasFeed("f")).toBe(false);
    },
  );
  test("the body is checked against what was declared", async () => {
    for (const [bytes, type] of [
      [PNG, "image/jpeg"],
      [JPG, "image/png"],
      [new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/png"],
      [new TextEncoder().encode("<html><script>x</script></html>"), "image/png"],
      [new Uint8Array(), "image/png"],
      [new Uint8Array([0xff, 0xfe, 0x41]), "text/markdown"],
    ] as [Uint8Array, string][]) {
      const res = await post(bytes as BodyInit, type);
      expect(res.status, type).toBe(415);
    }
    expect(await hasFeed("f")).toBe(false);
  });
  test("an empty or blank markdown body is 400 empty_note", async () => {
    for (const text of ["", "  \n "]) {
      const res = await post(text, "text/markdown");
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("empty_note");
    }
  });
  test("a refused post creates no protected empty feed either", async () => {
    const res = await post(PNG, "image/jpeg", { "x-feed-password": "hunter22" });
    expect(res.status).toBe(415);
    expect(await hasFeed("f")).toBe(false);
    expect(await protectedFeed("f")).toBe(false);
  });
});

describe("images", () => {
  test.each([
    ["image/png", PNG, "png"],
    ["image/jpeg", JPG, "jpg"],
    ["image/gif", GIF, "gif"],
    ["image/webp", WEBP, "webp"],
  ] as const)("%s is stored as .%s, byte for byte", async (type, bytes, ext) => {
    const res = await post(bytes as BodyInit, type);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.file).toBe(`${body.id}.${ext}`);
    expect([...(await stored(body.file))]).toEqual([...bytes]);
  });
  test("over NOTEFEED_MAX_IMAGE_BYTES is 413, over 100 KiB of markdown is 413", async () => {
    process.env.NOTEFEED_MAX_IMAGE_BYTES = "20";
    expect((await post(new Uint8Array([...PNG, ...new Uint8Array(20)]) as BodyInit, "image/png")).status).toBe(413);
    delete process.env.NOTEFEED_MAX_IMAGE_BYTES;
    expect((await post("a".repeat(102401), "text/markdown")).status).toBe(413);
    expect((await post("a".repeat(102400), "text/markdown")).status).toBe(201);
  });
  test("the caps are per type: images have their own, the notes limit counts markdown", async () => {
    process.env.NOTEFEED_MAX_IMAGES_PER_FEED = "1";
    process.env.NOTEFEED_MAX_NOTES_PER_FEED = "1";
    expect((await post(PNG as BodyInit, "image/png")).status).toBe(201);
    expect((await post("# a", "text/markdown")).status).toBe(201);
    const image = await post(PNG as BodyInit, "image/png");
    expect([image.status, (await image.json()).code]).toEqual([507, "image_limit"]);
    const note = await post("# b", "text/markdown");
    expect([note.status, (await note.json()).code]).toEqual([507, "note_limit"]);
  });
});

describe("metadata and creation settings are headers", () => {
  test("title, tags, alt and name, UTF-8 included", async () => {
    const res = await post(PNG as BodyInit, "image/png", {
      "x-note-title": encodeHeaderValue("Café 日本語"),
      "x-note-alt": encodeHeaderValue("Größe"),
      "x-note-name": encodeHeaderValue("Größe.png"),
      "x-note-tags": "CI, deploy",
    });
    const { file } = await res.json();
    expect(JSON.parse((await readFile(join(dir, "f", `.${file}.json`))).toString())).toEqual({ title: "Café 日本語", alt: "Größe", name: "Größe.png", tags: ["ci", "deploy"] });
  });
  test("alt on a markdown note is 400, and nothing is created", async () => {
    const res = await post("# a", "text/markdown", { "x-note-alt": "text" });
    expect(res.status).toBe(400);
    expect(await hasFeed("f")).toBe(false);
  });
  test("a bad title, tag or an over-long alt is 400", async () => {
    expect((await post("# a", "text/markdown", { "x-note-title": "x".repeat(101) })).status).toBe(400);
    expect((await post("# a", "text/markdown", { "x-note-tags": "bad tag" })).status).toBe(400);
    expect((await post(PNG as BodyInit, "image/png", { "x-note-alt": "x".repeat(501) })).status).toBe(400);
  });
  test("X-Feed-Password and X-Read-Id make the post that creates the feed protected, with that read id", async () => {
    const res = await post("# Locked", "text/markdown", { "x-feed-password": "hunter22", "x-read-id": "my-feed" });
    expect(res.status).toBe(201);
    expect(await readIdOf("f")).toBe("my-feed");
    expect(await protectedFeed("f")).toBe(true);
    expect((await post("# again", "text/markdown")).status).toBe(401);
    expect((await post("# again", "text/markdown", { "x-feed-password": "hunter22" })).status).toBe(201);
  });
  test("a taken read id is 409 and creates nothing; X-Read-Id on an existing feed is ignored", async () => {
    await post("# a", "text/markdown", { "x-read-id": "taken-id" });
    const other = await post("# b", "text/markdown", { "x-read-id": "taken-id" }, "g");
    expect(other.status).toBe(409);
    expect(await hasFeed("g")).toBe(false);
    expect((await post("# c", "text/markdown", { "x-read-id": "another-id" })).status).toBe(201);
    expect(await readIdOf("f")).toBe("taken-id");
  });
  test("the first note of a feed is one file; two posts are two files with their own ids", async () => {
    await post("# a", "text/markdown");
    await post("# b", "text/markdown");
    expect((await readdir(join(dir, "f"))).filter((n) => n.endsWith(".md"))).toHaveLength(2);
  });
});

test("the old image endpoint and the old body types are gone", async () => {
  const gone = await dispatch(new Request(`${BASE}${API_PREFIX}/feeds/f/images`, { method: "POST", body: PNG, headers: { host: "localhost:3000", "content-type": "image/png" } }), ["feeds", "f", "images"]);
  expect(gone.status).toBe(404);
  expect((await post(JSON.stringify({ markdown: "# a" }), "application/json")).status).toBe(415);
});
