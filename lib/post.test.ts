import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { readId, resetSecretForTests } from "./feeds";
import { feedExists } from "./notes";
import { handlePost } from "./post";

const BASE = "http://localhost:3000";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-post-"));
  process.env.DATA_DIR = dir;
  process.env.NOTEFEED_SECRET = "test-secret";
  resetSecretForTests();
  delete process.env.NOTEFEED_PASSWORD;
  delete process.env.PUBLIC_URL;
});

function post(body: BodyInit, headers: Record<string, string> = {}, feed = "test") {
  const h = new Headers({ host: "localhost:3000", ...headers });
  return handlePost(new Request(`${BASE}/${feed}`, { method: "POST", body, headers: h }), feed);
}

const file = (id: string, feed = "test") => readFile(join(dir, feed, `${id}.md`), "utf8");
// The data dir holds only the .secret file (if any) until a note is written.
const written = async () => (await readdir(dir)).filter((f) => f !== ".secret");

test("201 with markdown body; file equals body; response links", async () => {
  const res = await post("# Hi\nthere", { "content-type": "text/markdown" });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.id).toMatch(/^\d{8}T\d{6}Z-[a-z0-9-]+$/);
  expect(body).toEqual({
    id: body.id,
    url: `${BASE}/test/${body.id}`,
    feed_url: `${BASE}/test`,
    read_url: `${BASE}/r/${readId("test")}/feed.xml`,
  });
  expect(await file(body.id)).toBe("# Hi\nthere");
});

test.each(["application/x-www-form-urlencoded", "text/plain; charset=utf-8"])("accepts %s as raw text", async (type) => {
  const res = await post("# A&b=c\n100% done", { "content-type": type });
  expect(res.status).toBe(201);
  const { id } = await res.json();
  expect(await file(id)).toBe("# A&b=c\n100% done");
});

test("accepts a body without content type", async () => {
  expect((await post(new TextEncoder().encode("# Raw"))).status).toBe(201);
});

test("accepts JSON {markdown}", async () => {
  const res = await post(JSON.stringify({ markdown: "# J" }), { "content-type": "application/json" });
  expect(res.status).toBe(201);
  expect(await file((await res.json()).id)).toBe("# J");
});

test("400 for JSON without a markdown string, or invalid JSON", async () => {
  const noMd = await post(JSON.stringify({ text: "x" }), { "content-type": "application/json" });
  expect(noMd.status).toBe(400);
  expect(await noMd.json()).toEqual({ error: 'JSON needs a "markdown" string' });
  const bad = await post("{not json", { "content-type": "application/json" });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ error: "invalid JSON" });
});

test("415 for other content types", async () => {
  const res = await post("x", { "content-type": "image/png" });
  expect(res.status).toBe(415);
  expect(await res.json()).toEqual({ error: "send text/markdown, text/plain or application/json" });
});

test("400 for an empty body", async () => {
  const res = await post("  \n", { "content-type": "text/plain" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "note is empty" });
});

test("size limit is 102400 bytes", async () => {
  expect((await post("a".repeat(102400), { "content-type": "text/plain" })).status).toBe(201);
  const res = await post("a".repeat(102401), { "content-type": "text/plain" });
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "note exceeds 100 KB" });
});

test("413 from the Content-Length header alone", async () => {
  const res = await post("small", { "content-type": "text/plain", "content-length": "200000" });
  expect(res.status).toBe(413);
});

test("keeps a leading BOM byte-for-byte", async () => {
  const res = await post("﻿# Bom\r\n", { "content-type": "text/plain" });
  expect(await file((await res.json()).id)).toBe("﻿# Bom\r\n");
});

test("400 for a body that is not UTF-8, and nothing written", async () => {
  const latin1 = new Uint8Array([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9]); // "# Café" in Latin-1
  const res = await post(latin1, { "content-type": "text/plain" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "body must be UTF-8" });
  expect(await written()).toEqual([]);
});

test.each(["..", "a/b", decodeURIComponent("%2e%2e"), decodeURIComponent("a%2Fb"), "", "Test", "a.b"])(
  "400 invalid feed name for %j, and nothing written",
  async (feed) => {
    const res = await post("# Hi", { "content-type": "text/plain" }, feed);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid feed name" });
    expect(await written()).toEqual([]);
  },
);

test("400 feed name is reserved", async () => {
  const res = await post("# Hi", { "content-type": "text/plain" }, "login");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "feed name is reserved" });
  expect(await written()).toEqual([]);
});

test("locked: 401 without or with a wrong password, and the feed is not created", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  for (const auth of [undefined, "Bearer nope", "pw"]) {
    const res = await post("# Hi", { "content-type": "text/plain", ...(auth ? { authorization: auth } : {}) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "missing or wrong password" });
  }
  expect(await feedExists("test")).toBe(false);
  expect(await written()).toEqual([]);
});

test("locked: 201 with the right bearer password", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect((await post("# Hi", { "content-type": "text/plain", authorization: "Bearer pw" })).status).toBe(201);
});

test("unlocked: any authorization header is ignored", async () => {
  for (const authorization of ["Bearer whatever", "garbage"])
    expect((await post("# Hi", { "content-type": "text/plain", authorization })).status).toBe(201);
});
