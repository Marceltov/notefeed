// A feed's read id: chosen when the post creates the feed, changed later, freed when left (ADR 0016).
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { InvalidBodyError, ReadIdTakenError } from "./errors";
import { ensureFeed, feedForReadId, hasFeed, readIdOf, resetFeedsForTests, setReadId } from "./feeds";
import { getFeed, getReadFeed } from "./index";
import { dispatch, API_PREFIX } from "./http/api";
import { fileRoute } from "./http/files";
import { createImageNote, createNote } from "./notes";
import { resetRateLimitsForTests } from "./limits";

const BASE = "http://localhost:3000";
let dir: string;
beforeEach(async () => {
  dir = process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-readid-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "NOTEFEED_ALLOW_CUSTOM_IDS", "NOTEFEED_RESERVED_FEEDS", "NOTEFEED_RESERVED_PASSWORD"]) delete process.env[k];
  resetFeedsForTests();
  resetRateLimitsForTests();
});

const onDisk = (feed: string) => readFile(join(dir, feed, ".readid"), "utf8");
async function call(method: string, path: string, body?: unknown) {
  const url = new URL(API_PREFIX + path, BASE);
  const segments = url.pathname.slice(API_PREFIX.length + 1).split("/");
  return dispatch(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { host: "localhost:3000", "content-type": "application/json" } }), segments);
}

describe("choosing it at creation", () => {
  test("the post that creates the feed sets it; it is on disk and found by it", async () => {
    expect((await call("POST", "/feeds/blog/notes", { markdown: "# hi", read_id: "my-blog" })).status).toBe(201);
    expect(await readIdOf("blog")).toBe("my-blog");
    expect(await onDisk("blog")).toBe("my-blog");
    expect(await feedForReadId("my-blog")).toBe("blog");
  });
  test("empty or left out is random (22 characters)", async () => {
    await call("POST", "/feeds/a/notes", { markdown: "x", read_id: "" });
    await call("POST", "/feeds/b/notes", { markdown: "x" });
    expect(await readIdOf("a")).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await readIdOf("b")).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
  test("ignored for a feed that exists, even a malformed one", async () => {
    await createNote("blog", "x");
    const before = await readIdOf("blog");
    expect((await call("POST", "/feeds/blog/notes", { markdown: "y", read_id: "Not Valid!" })).status).toBe(201);
    expect(await readIdOf("blog")).toBe(before);
  });
  test.each(["ab", "x".repeat(65), "Upper", "a b", "a.b", "a/b"])("%j is refused (400) and nothing is created", async (bad) => {
    expect((await call("POST", "/feeds/blog/notes", { markdown: "x", read_id: bad })).status).toBe(400);
    expect(await hasFeed("blog")).toBe(false);
  });
  test("one that is another feed's is 409 and nothing is created", async () => {
    await createNote("one", "x", undefined, undefined, [], "taken-id");
    const res = await call("POST", "/feeds/two/notes", { markdown: "x", read_id: "taken-id" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("taken");
    expect(await hasFeed("two")).toBe(false);
    expect(await readIdOf("one")).toBe("taken-id");
  });
  test("a reserved feed's name is held back", async () => {
    process.env.NOTEFEED_RESERVED_FEEDS = "news";
    await expect(ensureFeed("blog", "news")).rejects.toBeInstanceOf(ReadIdTakenError);
  });
  test("two feeds asking for one id at once: exactly one gets it", async () => {
    const r = await Promise.allSettled([ensureFeed("a", "same-id"), ensureFeed("b", "same-id")]);
    expect(r.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect([await feedForReadId("same-id")]).toHaveLength(1);
  });
  test("a protected new feed gets it too", async () => {
    expect((await call("POST", "/feeds/vault/notes", { markdown: "x", password: "hunter22", read_id: "vault-id" })).status).toBe(201);
    expect(await readIdOf("vault")).toBe("vault-id");
  });
});

describe("changing it later", () => {
  test("PUT sets it: the new one works, the old one is freed, and it survives a restart", async () => {
    await createNote("blog", "x");
    const old = (await readIdOf("blog"))!;
    const res = await call("PUT", "/feeds/blog", { title: "", description: "", read_id: "new-id" });
    expect(res.status).toBe(200);
    expect((await res.json()).read_url).toContain("/r/new-id/feed.xml");
    expect(await feedForReadId(old)).toBeNull();
    expect(await feedForReadId("new-id")).toBe("blog");
    resetFeedsForTests(); // a restart reads it from the disk
    expect(await readIdOf("blog")).toBe("new-id");
    expect(await getReadFeed(old)).toMatchObject({ notes: [] }); // an empty feed, like any unknown id
  });
  test("the freed id can be taken by another feed", async () => {
    await createNote("a", "x", undefined, undefined, [], "first-id");
    await setReadId("a", "a-new");
    await ensureFeed("b", "first-id");
    expect(await feedForReadId("first-id")).toBe("b");
  });
  test("empty gives a random one; the current one is no change; omitted keeps it", async () => {
    await createNote("blog", "x", undefined, undefined, [], "chosen");
    expect((await call("PUT", "/feeds/blog", { title: "", description: "", read_id: "chosen" })).status).toBe(200);
    expect(await readIdOf("blog")).toBe("chosen");
    await call("PUT", "/feeds/blog", { title: "t", description: "" });
    expect(await readIdOf("blog")).toBe("chosen");
    await call("PUT", "/feeds/blog", { title: "", description: "", read_id: "" });
    expect(await readIdOf("blog")).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
  test("a taken or malformed one is refused and nothing changes, not even the settings", async () => {
    await createNote("a", "x", undefined, undefined, [], "id-a");
    await createNote("b", "x", undefined, undefined, [], "id-b");
    expect((await call("PUT", "/feeds/b", { title: "new", description: "", read_id: "id-a" })).status).toBe(409);
    expect((await call("PUT", "/feeds/b", { title: "new", description: "", read_id: "No!" })).status).toBe(400);
    expect(await readIdOf("b")).toBe("id-b");
    expect((await getFeed("b"))!.title).toBe("");
  });
  test("a reserved feed keeps its read id", async () => {
    process.env.NOTEFEED_RESERVED_FEEDS = "news";
    process.env.NOTEFEED_RESERVED_PASSWORD = "hunter22";
    resetFeedsForTests();
    const res = await dispatch(new Request(`${BASE}${API_PREFIX}/feeds/news`, { method: "PUT", body: JSON.stringify({ title: "", description: "", read_id: "other" }), headers: { host: "localhost:3000", "content-type": "application/json", "x-feed-password": "hunter22" } }), ["feeds", "news"]);
    expect(res.status).toBe(400);
    expect(await readIdOf("news")).toBe("news");
  });
  test("a change and a post at the same time leave the index and the disk agreeing", async () => {
    await createNote("blog", "x");
    await Promise.all([setReadId("blog", "changed"), createNote("blog", "y"), createNote("blog", "z")]);
    const live = await readIdOf("blog");
    resetFeedsForTests();
    expect(await readIdOf("blog")).toBe(live);
    expect(await onDisk("blog")).toBe(live);
  });
  test("two changes of one feed at once end on one id, on disk and in the index", async () => {
    await createNote("blog", "x");
    await Promise.allSettled([setReadId("blog", "first"), setReadId("blog", "second")]);
    const live = (await readIdOf("blog"))!;
    expect(await onDisk("blog")).toBe(live);
    expect((await Promise.all(["first", "second"].map((i) => feedForReadId(i)))).filter(Boolean)).toHaveLength(1);
  });
});

describe("the switch NOTEFEED_ALLOW_CUSTOM_IDS=0", () => {
  beforeEach(() => void (process.env.NOTEFEED_ALLOW_CUSTOM_IDS = "0"));
  test("a chosen id is refused, creating or changing; empty (random) still works", async () => {
    expect((await call("POST", "/feeds/blog/notes", { markdown: "x", read_id: "my-blog" })).status).toBe(400);
    expect(await hasFeed("blog")).toBe(false);
    await createNote("blog", "x");
    expect((await call("PUT", "/feeds/blog", { title: "", description: "", read_id: "my-blog" })).status).toBe(400);
    expect((await call("PUT", "/feeds/blog", { title: "", description: "", read_id: "" })).status).toBe(200);
    await expect(setReadId("blog", "again")).rejects.toBeInstanceOf(InvalidBodyError);
  });
});

describe("images follow the read id without editing a note", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
  test("the file is served under the new id and not the old; the title image URL follows; notes are untouched", async () => {
    await createNote("blog", "x");
    const file = (await createImageNote("blog", PNG, {})).note.file;
    const note = `![](${file})`;
    await createNote("blog", note);
    await call("PUT", "/feeds/blog", { title: "", description: "", image: file });
    const old = (await readIdOf("blog"))!;
    expect((await fileRoute(old, file)).status).toBe(200);
    await setReadId("blog", "moved");
    expect((await fileRoute("moved", file)).status).toBe(200);
    expect((await fileRoute(old, file)).status).toBe(404);
    expect((await getFeed("blog"))!.imageUrl).toBe(`/r/moved/${file}`);
    expect((await getFeed("blog"))!.notes.map((n) => n.markdown)).toContain(note);
  });
});
