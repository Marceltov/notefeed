import { mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { createProtected } from "../feedlock";
import { getFeed, getReadFeed } from "../index";
import { deleteFeed, resetFeedsForTests, readIdOf } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { createNote } from "../notes";
import { API_PREFIX, dispatch } from "./api";
import { imageRoute } from "./images";
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
const upload = (feed: string, body: BodyInit, type = "image/png", headers: Record<string, string> = {}) =>
  call("POST", `/feeds/${feed}/images`, { body, headers: { "content-type": type, ...headers } });
const get = (rid: string, file: string) => imageRoute(rid, file);

describe("POST /feeds/{feed}/images", () => {
  test("201 with file, absolute url under the read id, and markdown", async () => {
    await createNote("pics", "# x");
    const res = await upload("pics", PNG);
    expect(res.status).toBe(201);
    const body = await res.json();
    const rid = (await readIdOf("pics"))!;
    expect(body.file).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(body.url).toBe(`${BASE}/r/${rid}/images/${body.file}`);
    expect(body.markdown).toBe(`![](${body.url})`);
    expect(body.url).not.toContain("pics");
    expect((await upload("pics", PNG)).status).toBe(201); // same bytes again
    expect(await readdir(join(process.env.DATA_DIR!, "pics", ".images"))).toEqual([body.file]);
  });
  test("a feed that does not exist is 404 and no directory is made", async () => {
    const res = await upload("ghost", PNG);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no such feed", code: "not_found" });
    await expect(stat(join(process.env.DATA_DIR!, "ghost"))).rejects.toThrow();
  });
  test("bytes decide: a PNG sent as text/plain is accepted, HTML sent as image/png is 415", async () => {
    await createNote("pics", "# x");
    expect((await upload("pics", PNG, "text/plain")).status).toBe(201);
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
    await expect(readdir(join(process.env.DATA_DIR!, "pics", ".images"))).rejects.toThrow();
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
    const url = new URL(API_PREFIX + "/feeds/pics/images", BASE);
    const res = await dispatch(new Request(url, { method: "POST", body, headers: { host: "localhost:3000" }, duplex: "half" } as RequestInit), ["feeds", "pics", "images"]);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });
  test("the image cap answers 507 image_limit", async () => {
    process.env.NOTEFEED_MAX_IMAGES_PER_FEED = "1";
    await createNote("pics", "# x");
    expect((await upload("pics", PNG)).status).toBe(201);
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
  test("a feed deleted before the write is 404 and not re-created", async () => {
    await createNote("pics", "# x");
    // the feed vanishes while the body is being read
    const url = new URL(API_PREFIX + "/feeds/pics/images", BASE);
    const body = new ReadableStream(
      {
        async pull(c) {
          await deleteFeed("pics");
          c.enqueue(PNG);
          c.close();
        },
      },
      { highWaterMark: 0 }, // no pull until the handler reads
    );
    const res = await dispatch(new Request(url, { method: "POST", body, headers: { host: "localhost:3000" }, duplex: "half" } as RequestInit), ["feeds", "pics", "images"]);
    expect(res.status).toBe(404);
    await expect(stat(join(process.env.DATA_DIR!, "pics"))).rejects.toThrow();
  });
});

describe("GET /r/{readId}/images/{file}", () => {
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
    for (const bad of ["../x", ".password", file.toUpperCase(), "a".repeat(33) + ".png", "..%2Fx", "a".repeat(32) + ".png"]) expect((await get(rid, bad)).status).toBe(404);
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
    const { file, url } = await (await upload("pics", PNG)).json();
    const res = await put("pics", { title: "T", description: "D", image: file });
    expect(res.status).toBe(200);
    expect((await res.json()).image_url).toBe(url);
    expect((await (await call("GET", "/feeds/pics")).json()).image_url).toBe(url);
    const rid = (await readIdOf("pics"))!;
    expect((await (await call("GET", `/read/${rid}`)).json()).image_url).toBe(url);
    expect((await getFeed("pics"))!.imageUrl).toBe(`/r/${rid}/images/${file}`);
    expect((await getReadFeed(rid))!.imageUrl).toBe(`/r/${rid}/images/${file}`);
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
  test("an old .feed.json without image reads as empty", async () => {
    await createNote("pics", "# x");
    await writeFile(join(process.env.DATA_DIR!, "pics", ".feed.json"), JSON.stringify({ title: "Old", description: "" }));
    expect((await getFeed("pics"))!.imageUrl).toBeNull();
  });
});

test("a settings image can't name a real file outside .images", async () => {
  await createNote("pics", "# x");
  await writeFile(join(process.env.DATA_DIR!, "pics", "secret.txt"), "x");
  await upload("pics", PNG); // makes .images
  const res = await call("PUT", "/feeds/pics", { body: JSON.stringify({ title: "", description: "", image: "../secret.txt" }), headers: { "content-type": "application/json" } });
  expect(res.status).toBe(400);
});
