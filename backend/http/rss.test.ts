import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { derivedReadId, readIdOf, resetFeedsForTests } from "../feeds";
import { createNote, replaceContent } from "../notes";
import { saveSettings } from "../feedsettings";
import { rssRoute } from "./rss";

const BASE = "http://localhost:3000";
beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-rss-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  delete process.env.NOTEFEED_PASSWORD;
  delete process.env.NOTEFEED_TITLE;
  delete process.env.PUBLIC_URL;
});

const get = (id: string) =>
  rssRoute(new Request(`${BASE}/r/${id}/feed.xml`, { headers: { host: "localhost:3000" } }), id);

test("serves the feed's notes with read-id links", async () => {
  const { note: a } = await createNote("secretname", "# One", new Date("2026-09-29T10:00:00Z"));
  const { note: b } = await createNote("secretname", "# Two", new Date("2026-09-29T11:00:00Z"));
  await createNote("other", "# Elsewhere");
  const rid = (await readIdOf("secretname"))!;
  const res = await get(rid);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
  const xml = await res.text();
  expect(xml.match(/<item>/g)).toHaveLength(2);
  const links = [...xml.matchAll(/<item>[\s\S]*?<link>(.*?)<\/link>/g)].map((m) => m[1]);
  expect(links).toEqual([`${BASE}/r/${rid}/${b.id}`, `${BASE}/r/${rid}/${a.id}`]);
  expect(xml).toContain(`<link>${BASE}/r/${rid}</link>`);
  expect(xml).not.toContain("Elsewhere");
  // The read URL must not leak the write name.
  expect(xml).toContain("<title>notefeed</title>");
  expect(xml).not.toContain("secretname");
});

test("channel title comes from NOTEFEED_TITLE", async () => {
  process.env.NOTEFEED_TITLE = "My notes";
  expect(await (await get(derivedReadId("x"))).text()).toContain("<title>My notes</title>");
});

test("unknown but well-formed read id → empty feed", async () => {
  await createNote("test", "# One");
  const res = await get("A".repeat(22));
  expect(res.status).toBe(200);
  expect(await res.text()).not.toContain("<item>");
});

test("malformed read id → 404", async () => {
  expect((await get("ab")).status).toBe(404);
});

test("public even when the instance is locked", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  await createNote("test", "# One");
  const res = await get((await readIdOf("test"))!);
  expect(res.status).toBe(200);
  expect((await res.text()).match(/<item>/g)).toHaveLength(1);
});

test("an edited note keeps its guid and shows the new text", async () => {
  const { note: n } = await createNote("test", "# Old\nbefore");
  await replaceContent("test", n.id, new TextEncoder().encode("# Old\nafter edit"), "text/markdown");
  const xml = await (await get((await readIdOf("test"))!)).text();
  expect(xml).toContain(`${n.id}</guid>`);
  expect(xml).toContain("after edit");
  expect(xml).not.toContain("before");
});

test("dc:creator shows the sender, and not when the feed hides it", async () => {
  await createNote("test", "# One", undefined, "Ann <a@b.c>");
  const rid = (await readIdOf("test"))!;
  expect(await (await get(rid)).text()).toContain("<dc:creator>Ann &lt;a@b.c&gt;</dc:creator>");
  await saveSettings("test", { title: "", description: "", image: "", showSender: false });
  const xml = await (await get(rid)).text();
  expect(xml).not.toContain("dc:creator");
  expect(xml).not.toContain("xmlns:dc");
});

test("a relative image link in a note is absolute in the feed, and the note on disk is unchanged", async () => {
  const { note } = await createNote("secretname", "# Pic\n\n![](abc.png) ![](https://x.test/y.png)");
  const rid = (await readIdOf("secretname"))!;
  const xml = await (await get(rid)).text();
  expect(xml).toContain(`![](${BASE}/r/${rid}/abc.png) ![](https://x.test/y.png)`);
  expect(note.markdown).toContain("![](abc.png)");
});
