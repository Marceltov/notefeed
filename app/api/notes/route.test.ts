import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { POST } from "./route";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-api-"));
  process.env.DATA_DIR = dir;
  process.env.NOTEFEED_TOKEN = "s3cret";
  delete process.env.PUBLIC_URL;
});

function post(body: BodyInit, headers: Record<string, string> = {}, auth: string | null = "Bearer s3cret") {
  const h = new Headers({ host: "localhost:3000", ...headers });
  if (auth) h.set("authorization", auth);
  return POST(new Request("http://localhost:3000/api/notes", { method: "POST", body, headers: h }));
}

test("401 without or with a wrong token, and nothing written", async () => {
  expect((await post("# Hi", {}, null)).status).toBe(401);
  expect((await post("# Hi", {}, "Bearer nope")).status).toBe(401);
  expect(await readdir(dir)).toEqual([]);
});

test("201 with markdown body; file equals body", async () => {
  const res = await post("# Hi\nthere", { "content-type": "text/markdown" });
  expect(res.status).toBe(201);
  const { id, url } = await res.json();
  expect(id).toMatch(/^\d{8}T\d{6}Z-[a-z0-9-]+$/);
  expect(url).toBe(`http://localhost:3000/n/${id}`);
  expect(await readFile(join(dir, `${id}.md`), "utf8")).toBe("# Hi\nthere");
});

test.each(["application/x-www-form-urlencoded", "text/plain; charset=utf-8"])(
  "accepts %s as raw text",
  async (type) => {
    const res = await post("# A&b=c\n100% done", { "content-type": type });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(await readFile(join(dir, `${id}.md`), "utf8")).toBe("# A&b=c\n100% done");
  },
);

test("accepts a body without content type", async () => {
  const res = await post(new TextEncoder().encode("# Raw"));
  expect(res.status).toBe(201);
});

test("accepts JSON {markdown}", async () => {
  const res = await post(JSON.stringify({ markdown: "# J" }), { "content-type": "application/json" });
  expect(res.status).toBe(201);
  const { id } = await res.json();
  expect(await readFile(join(dir, `${id}.md`), "utf8")).toBe("# J");
});

test("400 for JSON without a markdown string", async () => {
  expect((await post(JSON.stringify({ text: "x" }), { "content-type": "application/json" })).status).toBe(400);
  expect((await post("{not json", { "content-type": "application/json" })).status).toBe(400);
});

test("415 for other content types", async () => {
  expect((await post("x", { "content-type": "image/png" })).status).toBe(415);
});

test("400 for an empty body", async () => {
  expect((await post("  \n", { "content-type": "text/plain" })).status).toBe(400);
});

test("size limit is 102400 bytes", async () => {
  expect((await post("a".repeat(102400), { "content-type": "text/plain" })).status).toBe(201);
  expect((await post("a".repeat(102401), { "content-type": "text/plain" })).status).toBe(413);
});

test("keeps a leading BOM byte-for-byte", async () => {
  const res = await post("﻿# Bom\r\n", { "content-type": "text/plain" });
  const { id } = await res.json();
  expect(await readFile(join(dir, `${id}.md`), "utf8")).toBe("﻿# Bom\r\n");
});
