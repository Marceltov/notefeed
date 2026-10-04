import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { encodeHeaderValue } from "../../shared/headers";
import { protectedFeed } from "../feedlock";
import { hasFeed, readIdOf, resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { countNotes } from "../notes";
import { API_PREFIX, dispatch } from "./api";
import { readMultipart } from "./notes";

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
  test.each([null, "text/plain", "application/x-www-form-urlencoded", "application/octet-stream", "application/json", "image/svg+xml", "text/markdown; charset=iso-8859-1"])(
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

// A multipart post: `text`, `file` and `alt.<name>` parts, built from FormData as a browser or a client sends them.
const png = (name: string, bytes: Uint8Array = PNG, type = "image/png") => new File([bytes as BlobPart], name, { type });
function form(parts: [string, string | File][]): FormData {
  const f = new FormData();
  for (const [k, v] of parts) f.append(k, v);
  return f;
}
const sendForm = (parts: [string, string | File][], headers: Record<string, string> = {}, feed = "f") => post(form(parts), null, headers, feed);
const sidecarOf = async (file: string, feed = "f") => JSON.parse((await readFile(join(dir, feed, `.${file}.json`))).toString());

describe("multipart: a text with its pictures", () => {
  test("pictures then text: the answer is the text note plus every picture in part order, the text refers to the stored files", async () => {
    const text = '# Report\n\n![Chart](chart.png "Q3")\n\n![logo][l]\n\n[l]: logo.png\n';
    const res = await sendForm(
      [
        ["text", text],
        ["file", png("chart.png")],
        ["alt.chart.png", "A chart"],
        ["file", png("logo.png", JPG, "image/jpeg")],
      ],
      { "x-note-title": "T", "x-note-tags": "ci" },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.file).toBe(`${body.id}.md`);
    expect(body.url).toBe(`${BASE}/f/${body.id}`);
    const [chart, logo] = body.attachments;
    expect(body.attachments).toHaveLength(2);
    expect(chart.file).toBe(`${chart.id}.png`);
    expect(logo.file).toBe(`${logo.id}.jpg`);
    expect(chart.file_url).toBe(`${BASE}/r/${(await readIdOf("f"))!}/${chart.file}`);
    // FormData sends a string field's line breaks as CRLF (the HTML form-data encoding): the text is stored as it arrived.
    expect((await stored(body.file)).toString()).toBe(`# Report\n\n![Chart](${chart.file} "Q3")\n\n![logo][l]\n\n[l]: ${logo.file}\n`.replace(/\n/g, "\r\n"));
    expect([...(await stored(chart.file))]).toEqual([...PNG]);
    expect(await sidecarOf(body.file)).toEqual({ title: "T", tags: ["ci"] });
    expect(await sidecarOf(chart.file)).toEqual({ alt: "A chart", name: "chart.png", tags: ["ci"] });
    expect(await sidecarOf(logo.file)).toEqual({ name: "logo.png", tags: ["ci"] });
  });
  test("file names survive the multipart encoding: spaces, non-ASCII, a reference percent-encoded", async () => {
    const res = await sendForm([
      ["text", "![](a%20b.png) ![](Größe.png)"],
      ["file", png("a b.png")],
      ["file", png("Größe.png")],
    ]);
    expect(res.status).toBe(201);
    const { file, attachments } = await res.json();
    expect((await stored(file)).toString()).toBe(`![](${attachments[0].file}) ![](${attachments[1].file})`);
    expect((await sidecarOf(attachments[1].file)).name).toBe("Größe.png");
  });
  test("only files: just the pictures, each with the title and tags; the answer is the first picture", async () => {
    const res = await sendForm([["file", png("a.png")], ["file", png("b.png")]], { "x-note-title": "T", "x-note-tags": "ci" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attachments).toHaveLength(2);
    expect(body).toMatchObject({ id: body.attachments[0].id, file: body.attachments[0].file });
    for (const a of body.attachments) expect(await sidecarOf(a.file)).toMatchObject({ title: "T", tags: ["ci"] });
    expect(await countNotes("f", "markdown")).toBe(0);
    expect(await countNotes("f")).toBe(2);
  });
  test("only text equals a raw post, with no attachments", async () => {
    const res = await sendForm([["text", "# Hi"]], { "x-note-title": "T" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attachments).toEqual([]);
    expect((await stored(body.file)).toString()).toBe("# Hi");
    expect(await sidecarOf(body.file)).toEqual({ title: "T" });
  });
  test("a raw post's answer has no attachments", async () => {
    expect("attachments" in (await (await post("# a", "text/markdown")).json())).toBe(false);
  });

  const eleven = Array.from({ length: 11 }, (_, i) => ["file", png(`${i}.png`)] as [string, File]);
  test.each([
    ["no text and no file", [], {}],
    ["two text parts", [["text", "a"], ["text", "b"]], {}],
    ["a text field and a text file", [["text", "# a"], ["text", new File(["# b"], "b.md", { type: "text/markdown" })]], {}],
    ["a part named other", [["text", "a"], ["other", "x"]], {}],
    ["a file part without a file name", [["file", "just a string"]], {}],
    ["a duplicate file name", [["file", png("a.png")], ["file", png("a.png")]], {}],
    ["alt for a file that is not sent", [["file", png("a.png")], ["alt.x.png", "x"]], {}],
    ["X-Note-Alt", [["file", png("a.png")]], { "x-note-alt": "x" }],
    ["X-Note-Name", [["file", png("a.png")]], { "x-note-name": "x.png" }],
    ["11 files", eleven, {}],
    ["blank text and no file", [["text", "  "]], {}],
  ] as [string, [string, string | File][], Record<string, string>][])("%s is 400, and nothing is created", async (_, parts, headers) => {
    const res = await sendForm(parts, headers);
    expect(res.status).toBe(400);
    expect(await hasFeed("f")).toBe(false);
  });
  test("a body that is not multipart is 400 invalid_body", async () => {
    const res = await post("# Hi", "multipart/form-data; boundary=x");
    expect([res.status, (await res.json()).code]).toEqual([400, "invalid_body"]);
  });
  test("a picture that is not what it declares, or not a picture, is 415 and names the part", async () => {
    for (const file of [png("b.png", JPG), new File(["hi"], "b.txt", { type: "text/plain" }), new File([PNG as BlobPart], "b.png")]) {
      const res = await sendForm([["text", "# a"], ["file", png("a.png")], ["file", file]]);
      const body = await res.json();
      expect([res.status, body.code]).toEqual([415, "unsupported_type"]);
      expect(body.error).toContain(`attachment "${file.name}"`);
      expect(await hasFeed("f")).toBe(false);
    }
  });
  test("an oversize picture or a body over the request cap is 413, and nothing is created", async () => {
    process.env.NOTEFEED_MAX_IMAGE_BYTES = "20";
    expect((await sendForm([["text", "# a"], ["file", png("a.png", new Uint8Array([...PNG, ...new Uint8Array(20)]))]])).status).toBe(413);
    // The cap is 102400 + 10 * 20 bytes + 64 KiB of framing: an alt text that long would be a 400 if it were read.
    expect((await sendForm([["file", png("a.png")], ["alt.a.png", "a".repeat(102400 + 200 + 65536 + 1)]])).status).toBe(413);
    expect(await hasFeed("f")).toBe(false);
  });
  test("a request at every limit at once passes the request cap: 10 pictures at the image limit and a text at the markdown limit", async () => {
    process.env.NOTEFEED_MAX_IMAGE_BYTES = "20";
    const full = new Uint8Array([...PNG, ...new Uint8Array(20 - PNG.length)]);
    const files = Array.from({ length: 10 }, (_, i) => ["file", png(`${i}.png`, full)] as [string, File]);
    const req = (text: string) => new Request(`${BASE}${API_PREFIX}/feeds/f/notes`, { method: "POST", body: form([["text", text], ...files]) });
    // Read as the request cap sees it: a text of exactly MAX_BYTES can't be stored with pictures, their references make it longer.
    const read = await readMultipart(req("a".repeat(102400)), "post");
    expect([read.text!.length, read.pictures.length]).toEqual([102400, 10]);
    // Stored, with room left for the ten references.
    const res = await sendForm([["text", "a".repeat(102400 - 10 * 64)], ...files]);
    expect(res.status).toBe(201);
    expect((await res.json()).attachments).toHaveLength(10);
  });
  test("the text as a file part is stored byte for byte: no CRLF, a BOM kept; its name is ignored", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("# Hi\n\n![](a.png)\n")]);
    for (const type of ["text/markdown", "text/markdown; charset=utf-8"]) {
      const res = await sendForm([["text", new File([bytes as BlobPart], "whatever.txt", { type })], ["file", png("a.png")]]);
      expect(res.status, type).toBe(201);
      const { file, attachments } = await res.json();
      const text = (await stored(file)).toString();
      expect(text).not.toContain("\r");
      expect(text).toBe(`\uFEFF# Hi\n\n![](${attachments[0].file})\n`);
    }
  });
  test("a text file part may be application/octet-stream; another type is 415, invalid UTF-8 is 400, and they store nothing", async () => {
    const as = (bytes: BlobPart, type: string) => sendForm([["text", new File([bytes], "t.md", { type })], ["file", png("a.png")]]);
    expect((await as("# curl", "application/octet-stream")).status).toBe(201); // curl's label for a .md file
    const wrong = await as("# a", "image/png");
    expect([wrong.status, (await wrong.json()).code]).toEqual([415, "unsupported_type"]);
    expect((await as("# a", "text/markdown; charset=iso-8859-1")).status).toBe(415);
    const bad = await as(new Uint8Array([0xff, 0xfe, 0x41]) as BlobPart, "text/markdown");
    expect([bad.status, (await bad.json()).code]).toEqual([400, "invalid_body"]);
    expect(await countNotes("f")).toBe(2);
  });
  test("a protected feed: the first multipart post creates it, a refused one leaves none, a later post needs the password", async () => {
    const refused = await sendForm([["text", "# a"], ["file", png("a.png")], ["file", png("b.png", JPG)]], { "x-feed-password": "hunter22" }, "g");
    expect(refused.status).toBe(415);
    expect(await hasFeed("g")).toBe(false);
    expect(await protectedFeed("g")).toBe(false);
    expect((await sendForm([["text", "# a"], ["file", png("a.png")]], { "x-feed-password": "hunter22" })).status).toBe(201);
    expect(await protectedFeed("f")).toBe(true);
    expect((await sendForm([["file", png("b.png")]])).status).toBe(401);
    expect((await sendForm([["file", png("b.png")]], { "x-feed-password": "hunter22" })).status).toBe(201);
  });
  test("a double quote in a file name round-trips: FormData sends %22, the server decodes it", async () => {
    const res = await sendForm([["text", '![](<q"uote.png>)'], ["file", png('q"uote.png')]]);
    expect(res.status).toBe(201);
    const { file, attachments } = await res.json();
    expect((await stored(file)).toString()).toBe(`![](${attachments[0].file})`);
    expect((await sidecarOf(attachments[0].file)).name).toBe('q"uote.png');
  });
  test("the image cap holds for the post that would create the feed", async () => {
    process.env.NOTEFEED_MAX_IMAGES_PER_FEED = "2";
    const res = await sendForm([["file", png("a.png")], ["file", png("b.png")], ["file", png("c.png")]], {}, "new");
    expect([res.status, (await res.json()).code]).toEqual([507, "image_limit"]);
    expect(await hasFeed("new")).toBe(false);
  });
  test("the caps count the existing notes plus the new pictures", async () => {
    process.env.NOTEFEED_MAX_IMAGES_PER_FEED = "2";
    expect((await sendForm([["file", png("a.png")]])).status).toBe(201);
    const res = await sendForm([["text", "# a"], ["file", png("b.png")], ["file", png("c.png")]]);
    expect([res.status, (await res.json()).code]).toEqual([507, "image_limit"]);
    expect(await countNotes("f")).toBe(1);
  });
});
