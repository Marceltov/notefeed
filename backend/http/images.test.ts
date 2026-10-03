import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { config } from "../config";
import { createProtected } from "../feedlock";
import { getFeed, getReadFeed } from "../index";
import { deleteFeed, resetFeedsForTests, readIdOf } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { hasFeed } from "../feeds";
import { createNote, listNotes, removeNote } from "../notes";
import { API_PREFIX, dispatch } from "./api";
import { feedSettingsRoute } from "./feedforms";
import { fileRoute } from "./files";
import { rssRoute } from "./rss";

const BASE = "http://localhost:3000";
beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-imgapi-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL", "NOTEFEED_TITLE", "NOTEFEED_MAX_IMAGE_BYTES", "NOTEFEED_MAX_IMAGES_PER_FEED"]) delete process.env[k];
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const HTML_IN_PNG = new Uint8Array([...PNG, ...new TextEncoder().encode("<html><script>alert(1)</script></html>")]);

async function call(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
  const url = new URL(API_PREFIX + path, BASE);
  const segments = url.pathname.slice(API_PREFIX.length + 1).split("/").map(decodeURIComponent);
  return dispatch(new Request(url, { method, body: init.body, headers: { host: "localhost:3000", ...init.headers } }), segments);
}
// An image is posted like any note: the body is the picture.
const upload = (feed: string, body: BodyInit, type = "image/png", headers: Record<string, string> = {}) =>
  call("POST", `/feeds/${feed}/notes`, { body, headers: { "content-type": type, ...headers } });
const IMAGE_FILE_RE = /^[A-Za-z0-9_-]+\.(png|jpg|gif|webp)$/;
const imageFiles = async (feed: string) => (await readdir(join(process.env.DATA_DIR!, feed))).filter((f) => IMAGE_FILE_RE.test(f));
const get = (rid: string, file: string) => fileRoute(rid, file);

describe("POST /feeds/{feed}/notes with an image body", () => {
  test("201 with the note's id, its file and an absolute file_url under the read id", async () => {
    await createNote("pics", "# x");
    const res = await upload("pics", PNG);
    expect(res.status).toBe(201);
    const body = await res.json();
    const rid = (await readIdOf("pics"))!;
    expect(body.file).toBe(`${body.id}.png`);
    expect(body.file_url).toBe(`${BASE}/r/${rid}/${body.file}`);
    expect(body.url).toBe(`${BASE}/pics/${body.id}`);
    expect(body.file_url).not.toContain("pics/");
    expect(await imageFiles("pics")).toEqual([body.file]);
    expect((await upload("pics", PNG)).status).toBe(201); // the same bytes again are another note
    expect(await imageFiles("pics")).toHaveLength(2);
  });
  test("a multipart file part is an image note, with the password and read id of the post that creates the feed", async () => {
    const f = new FormData();
    f.set("file", new File([PNG], "cat.png", { type: "image/png" }));
    f.set("password", "hunter22");
    f.set("read_id", "my-pics");
    f.set("tags", "a, b");
    const res = await call("POST", "/feeds/pics/notes", { body: f });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.file).toBe(`${body.id}.png`);
    expect(await readIdOf("pics")).toBe("my-pics");
    expect((await get("my-pics", body.file)).status).toBe(200);
    const sidecar = JSON.parse(await readFile(join(process.env.DATA_DIR!, "pics", `.${body.file}.json`), "utf8"));
    expect(sidecar).toEqual({ tags: ["a", "b"], name: "cat.png" });
    expect((await upload("pics", PNG)).status).toBe(401); // protected by the first post's password
  });
  test("a form with both markdown and a file is 400", async () => {
    const f = new FormData();
    f.set("file", new File([PNG], "cat.png"));
    f.set("markdown", "# x");
    expect((await call("POST", "/feeds/pics/notes", { body: f })).status).toBe(400);
    expect(await hasFeed("pics")).toBe(false);
  });
  test("X-Note-Name is kept as the picture's name, cleaned of path characters", async () => {
    const res = await upload("pics", PNG, "image/png", { "x-note-name": "../my cat.png" });
    const { file } = await res.json();
    expect(JSON.parse(await readFile(join(process.env.DATA_DIR!, "pics", `.${file}.json`), "utf8"))).toEqual({ name: "..my cat.png" });
  });
  test("a feed that does not exist is created by its first image, like by a first note", async () => {
    const res = await upload("ghost", PNG);
    expect(res.status).toBe(201);
    expect(await hasFeed("ghost")).toBe(true);
    expect(await imageFiles("ghost")).toHaveLength(1);
  });
  test("bytes decide: a PNG sent as application/octet-stream is accepted, HTML sent as image/png is 415", async () => {
    await createNote("pics", "# x");
    expect((await upload("pics", PNG, "application/octet-stream")).status).toBe(201);
    const res = await upload("pics", "<html><script>x</script></html>", "image/png");
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe("unsupported_type");
  });
  test("over the cap is 413 and nothing is written", async () => {
    process.env.NOTEFEED_MAX_IMAGE_BYTES = "20";
    await createNote("pics", "# x");
    const res = await upload("pics", new Uint8Array([...PNG, ...new Uint8Array(20)]));
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("too_large");
    expect((await imageFiles("pics"))).toEqual([]);
  });
  test("a chunked body over the cap stops being read at the cap", async () => {
    process.env.NOTEFEED_MAX_IMAGE_BYTES = "20";
    await createNote("pics", "# x");
    let pulled = 0;
    const body = new ReadableStream({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(10));
        if (pulled > 1000) c.close();
      },
    });
    const url = new URL(API_PREFIX + "/feeds/pics/notes", BASE);
    const res = await dispatch(new Request(url, { method: "POST", body, headers: { host: "localhost:3000", "content-type": "image/png" }, duplex: "half" } as RequestInit), ["feeds", "pics", "notes"]);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });
  test("the image cap answers 507 image_limit; markdown notes are not images", async () => {
    process.env.NOTEFEED_MAX_IMAGES_PER_FEED = "1";
    await createNote("pics", "# x");
    expect((await upload("pics", PNG)).status).toBe(201);
    expect((await call("POST", "/feeds/pics/notes", { body: "# more", headers: { "content-type": "text/markdown" } })).status).toBe(201);
    const res = await upload("pics", new Uint8Array([...PNG, 9]));
    expect(res.status).toBe(507);
    expect((await res.json()).code).toBe("image_limit");
  });
  test("a protected feed needs its password", async () => {
    await createProtected("locked", "hunter22");
    await createNote("locked", "# x");
    expect((await upload("locked", PNG)).status).toBe(401);
    expect((await upload("locked", PNG, "image/png", { "x-feed-password": "wrong-one" })).status).toBe(401);
    expect((await upload("locked", PNG, "image/png", { "x-feed-password": "hunter22" })).status).toBe(201);
  });
  test("a locked instance needs the Bearer password", async () => {
    process.env.NOTEFEED_PASSWORD = "instance-pw";
    await createNote("pics", "# x");
    expect((await upload("pics", PNG)).status).toBe(401);
    expect((await upload("pics", PNG, "image/png", { authorization: "Bearer instance-pw" })).status).toBe(201);
  });
  test("uploads count against the post rate limit", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "2";
    await createNote("pics", "# x");
    expect((await upload("pics", PNG)).status).toBe(201);
    expect((await upload("pics", PNG)).status).toBe(201);
    expect((await upload("pics", PNG)).status).toBe(429);
  });
});

describe("upload: body edge cases", () => {
  test("a body shorter than its Content-Length is refused and nothing is stored", async () => {
    await createNote("pics", "# x");
    const res = await upload("pics", PNG, "image/png", { "content-length": String(PNG.length + 100) });
    expect(res.status).toBe(413);
    expect((await imageFiles("pics"))).toEqual([]);
  });
  test("a configured cap above 10 MiB behaves as 10 MiB (the proxy buffers no more)", async () => {
    process.env.NOTEFEED_MAX_IMAGE_BYTES = "20971520";
    expect(config.maxImageBytes()).toBe(10485760);
    await createNote("pics", "# x");
    const res = await upload("pics", new Uint8Array([...PNG, ...new Uint8Array(10485760)]));
    expect(res.status).toBe(413);
  });
  test("an open feed that lost all its notes still takes uploads and gets a URL", async () => {
    const note = await createNote("pics", "# x");
    await removeNote("pics", note.note.id);
    expect(await listNotes("pics", 10)).toEqual([]);
    const res = await upload("pics", PNG);
    expect(res.status).toBe(201);
    expect((await res.json()).file_url).toContain(`/r/${await readIdOf("pics")}/`);
  });
});

describe("GET /r/{readId}/{file}", () => {
  test("bytes with the four headers; a protected feed needs no password", async () => {
    await createProtected("locked", "hunter22");
    await createNote("locked", "# x");
    const { file } = await (await upload("locked", PNG, "image/png", { "x-feed-password": "hunter22" })).json();
    const rid = (await readIdOf("locked"))!;
    const res = await get(rid, file);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });
  test("a PNG-headed HTML payload is served as image/png", async () => {
    await createNote("pics", "# x");
    const { file } = await (await upload("pics", HTML_IN_PNG)).json();
    const res = await get((await readIdOf("pics"))!, file);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });
  test("a wrong read id, a bad name and a missing file are 404", async () => {
    await createNote("pics", "# x");
    await createNote("other", "# y");
    const { file } = await (await upload("pics", PNG)).json();
    expect((await get((await readIdOf("other"))!, file)).status).toBe(404);
    expect((await get("x".repeat(22), file)).status).toBe(404);
    const rid = (await readIdOf("pics"))!;
    for (const bad of ["../x", ".password", "a.b.png", "..%2Fx", "nope.png"]) expect((await get(rid, bad)).status).toBe(404);
  });
  test("every non-dot file of the feed is served: a markdown note as text, a hand-placed file as a download", async () => {
    const { note } = await createNote("pics", "# Hi");
    await writeFile(join(process.env.DATA_DIR!, "pics", "report.pdf"), "%PDF-1.4");
    const rid = (await readIdOf("pics"))!;
    const md = await get(rid, note.file);
    expect(md.status).toBe(200);
    expect(await md.text()).toBe("# Hi");
    expect(md.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(md.headers.get("cache-control")).toBe("no-cache");
    expect(md.headers.get("content-disposition")).toBeNull();
    const pdf = await get(rid, "report.pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/octet-stream");
    expect(pdf.headers.get("content-disposition")).toBe("attachment");
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
    expect(pdf.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });
  test("dot files are never served: the read id, the password, the settings, a note's sidecar", async () => {
    const { note } = await createNote("pics", "# Hi", undefined, "Ann");
    const dir = join(process.env.DATA_DIR!, "pics");
    await writeFile(join(dir, ".password"), "hash");
    await writeFile(join(dir, ".feed.json"), "{}");
    const rid = (await readIdOf("pics"))!;
    for (const name of [".readid", ".password", ".feed.json", `.${note.file}.json`, "..", "."]) expect((await get(rid, name)).status).toBe(404);
  });
  test("a symbolic link in the feed folder is not followed", async () => {
    await createNote("pics", "# Hi");
    await writeFile(join(process.env.DATA_DIR!, "outside.txt"), "secret");
    await symlink(join(process.env.DATA_DIR!, "outside.txt"), join(process.env.DATA_DIR!, "pics", "link.txt"));
    expect((await get((await readIdOf("pics"))!, "link.txt")).status).toBe(404);
  });
  test("the feed's name never serves it", async () => {
    await createNote("pics", "# x");
    const { file } = await (await upload("pics", PNG)).json();
    expect((await get("pics", file)).status).toBe(404);
  });
  test("a deleted feed takes its images with it", async () => {
    await createNote("pics", "# x");
    const { file } = await (await upload("pics", PNG)).json();
    const rid = (await readIdOf("pics"))!;
    await deleteFeed("pics");
    expect((await get(rid, file)).status).toBe(404);
  });
});

describe("feed settings: image", () => {
  const put = (feed: string, body: unknown) => call("PUT", `/feeds/${feed}`, { body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  test("round-trips and shows as image_url (API, read API, getFeed, RSS)", async () => {
    await createNote("pics", "# x");
    const { file, file_url: url } = await (await upload("pics", PNG)).json();
    const res = await put("pics", { title: "T", description: "D", image: file });
    expect(res.status).toBe(200);
    expect((await res.json()).image_url).toBe(url);
    expect((await (await call("GET", "/feeds/pics")).json()).image_url).toBe(url);
    const rid = (await readIdOf("pics"))!;
    expect((await (await call("GET", `/read/${rid}`)).json()).image_url).toBe(url);
    expect((await getFeed("pics"))!.imageUrl).toBe(`/r/${rid}/${file}`);
    expect((await getReadFeed(rid))!.imageUrl).toBe(`/r/${rid}/${file}`);
    const xml = await (await rssRoute(new Request(`${BASE}/r/${rid}/feed.xml`, { headers: { host: "localhost:3000" } }), rid)).text();
    expect(xml).toContain(`<image><url>${url}</url><title>T</title><link>${BASE}/r/${rid}</link></image>`);
  });
  test("omitted image keeps it; empty clears it; no image means null", async () => {
    await createNote("pics", "# x");
    const { file } = await (await upload("pics", PNG)).json();
    expect((await (await call("GET", "/feeds/pics")).json()).image_url).toBeNull();
    await put("pics", { title: "", description: "", image: file });
    expect((await (await put("pics", { title: "A", description: "" })).json()).image_url).toContain(file);
    expect((await (await put("pics", { title: "A", description: "", image: "" })).json()).image_url).toBeNull();
  });
  test.each(["a".repeat(32) + ".png", "../x", ".password", 5])("an image that is not this feed's is 400 invalid_body: %j", async (image) => {
    await createNote("pics", "# x");
    const res = await put("pics", { title: "", description: "", image });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
  });
  test("another feed's image is refused", async () => {
    await createNote("pics", "# x");
    await createNote("other", "# y");
    const { file } = await (await upload("other", PNG)).json();
    expect((await put("pics", { title: "", description: "", image: file })).status).toBe(400);
  });
  test("deleting the image note removes the title image", async () => {
    await createNote("pics", "# x");
    const { id, file } = await (await upload("pics", PNG)).json();
    await put("pics", { title: "T", description: "D", image: file });
    expect((await getFeed("pics"))!.imageUrl).toContain(file);
    expect((await call("DELETE", `/feeds/pics/notes/${id}`)).status).toBe(204);
    expect((await getFeed("pics"))!.imageUrl).toBeNull();
    expect((await (await call("GET", "/feeds/pics")).json()).image_url).toBeNull();
  });
  test("a markdown note is not an image: 400", async () => {
    const { note } = await createNote("pics", "# x");
    expect((await put("pics", { title: "", description: "", image: note.file })).status).toBe(400);
  });
  test("a title image removed by hand: saves keep working and it shows nowhere", async () => {
    await createNote("pics", "# x");
    const { file } = await (await upload("pics", PNG)).json();
    expect((await put("pics", { title: "T", description: "D", image: file })).status).toBe(200);
    await rm(join(process.env.DATA_DIR!, "pics", file));
    const res = await put("pics", { title: "T2", description: "D" });
    expect(res.status).toBe(200);
    expect((await res.json()).image_url).toBeNull();
    expect((await (await call("GET", "/feeds/pics")).json()).image_url).toBeNull();
    const rid = (await readIdOf("pics"))!;
    expect((await (await call("GET", `/read/${rid}`)).json()).image_url).toBeNull();
    expect((await getFeed("pics"))!.imageUrl).toBeNull();
    expect((await getReadFeed(rid))!.imageUrl).toBeNull();
    const xml = await (await rssRoute(new Request(`${BASE}/r/${rid}/feed.xml`, { headers: { host: "localhost:3000" } }), rid)).text();
    expect(xml).not.toContain("<image>");
    const form = await feedSettingsRoute(
      new Request(`${BASE}/pics/settings`, { method: "POST", headers: { host: "localhost:3000", origin: BASE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ title: "T3", description: "D" }) }),
      "pics",
    );
    expect(form.headers.get("location")).toBe("/pics/settings?saved=1");
  });
  test("an old .feed.json without image reads as empty", async () => {
    await createNote("pics", "# x");
    await writeFile(join(process.env.DATA_DIR!, "pics", ".feed.json"), JSON.stringify({ title: "Old", description: "" }));
    expect((await getFeed("pics"))!.imageUrl).toBeNull();
  });
});

test("a settings image can't name a real file that is not an image", async () => {
  await createNote("pics", "# x");
  await writeFile(join(process.env.DATA_DIR!, "pics", "secret.txt"), "x");
  const res = await call("PUT", "/feeds/pics", { body: JSON.stringify({ title: "", description: "", image: "../secret.txt" }), headers: { "content-type": "application/json" } });
  expect(res.status).toBe(400);
});
