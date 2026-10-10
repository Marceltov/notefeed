// The operator's takedown (#155) on the file system backend, end to end through the HTTP handlers: what a removed feed answers
// under both identifiers, and that its images are refused everywhere afterwards. The SQL backends run the same storage contract
// (backend/storage/contract.ts) and the route test in http/operator.test.ts.
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi, afterEach } from "vitest";
import { createNote } from "./notes";
import { feedForReadId, hasFeed, isRemovedFeed, readIdOf, resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";
import { logsOf } from "./log";
import { API_PREFIX, dispatch } from "./http/api";
import { fileRoute } from "./http/files";
import { takedownRoute } from "./http/operator";
import { rssRoute } from "./http/rss";
import { readIdOfTarget } from "./takedown";

const TOKEN = "operator-token-".padEnd(40, "x");
const BASE = "http://localhost:3000";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const PNG2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 8, 8]);
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "notefeed-takedown-"));
  vi.stubEnv("DATA_DIR", root);
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", TOKEN);
  vi.stubEnv("NOTEFEED_RATE_LIMIT", "0");
  resetFeedsForTests();
  resetRateLimitsForTests();
});
afterEach(() => vi.unstubAllEnvs());

async function call(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
  const url = new URL(API_PREFIX + path, BASE);
  const segments = url.pathname.slice(API_PREFIX.length + 1).split("/").map(decodeURIComponent);
  return dispatch(new Request(url, { method, body: init.body, headers: { host: "localhost:3000", ...init.headers } }), segments);
}
const upload = (feed: string, body: Uint8Array, headers: Record<string, string> = {}) => call("POST", `/feeds/${feed}/notes`, { body: body as BodyInit, headers: { "content-type": "image/png", ...headers } });
const takedown = (target: unknown, authorization = `Bearer ${TOKEN}`) =>
  takedownRoute(new Request(`${BASE}/api/operator/takedown`, { method: "POST", body: JSON.stringify({ target }), headers: { "content-type": "application/json", authorization } }));

test("readIdOfTarget: a read link, a note's read URL, an image URL, a bare id; anything else is null", () => {
  expect(readIdOfTarget("https://notes.example.com/r/abc-123/20260101T000000Z-x.png")).toBe("abc-123");
  expect(readIdOfTarget("https://notes.example.com/r/abc-123/feed.xml")).toBe("abc-123");
  expect(readIdOfTarget("https://notes.example.com/r/abc-123")).toBe("abc-123");
  expect(readIdOfTarget("/r/abc-123/")).toBe("abc-123");
  expect(readIdOfTarget(" abc-123 ")).toBe("abc-123");
  for (const bad of ["", "https://notes.example.com/myfeed", "https://notes.example.com/r/", "not a url", "/r/a b"]) expect(readIdOfTarget(bad), bad).toBeNull();
});

describe("a feed taken down by its image URL", () => {
  test("answers removed under its read id and its name, its content is gone, and its image is refused everywhere", async () => {
    expect((await call("POST", "/feeds/bad/notes", { body: "# text", headers: { "content-type": "text/markdown", "x-read-id": "removed-feed-id" } })).status).toBe(201);
    const pic = await (await upload("bad", PNG)).json();
    const rid = (await readIdOf("bad"))!;
    expect(rid).toBe("removed-feed-id");
    let res!: Response;
    const lines = await logsOf(async () => void (res = await takedown(pic.file_url)), "info");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true, already_removed: false, notes: 2, images: 1, blocked: 1, image_keys: [] });
    const line = lines.find((l) => l.msg === "feed removed by the operator");
    expect(line).toMatchObject({ notes: 2, images: 1, blocked: 1 });
    expect(JSON.stringify(lines)).not.toContain('"bad"');

    expect(await hasFeed("bad")).toBe(false);
    expect(await isRemovedFeed("bad")).toBe(true);
    expect(await feedForReadId(rid)).toBeNull();
    expect((await rssRoute(new Request(`${BASE}/r/${rid}/feed.xml`), rid)).status).toBe(410);
    expect((await fileRoute(rid, pic.file)).status).toBe(410);
    expect((await readdir(root)).filter((n) => !n.startsWith("."))).toEqual([]);
    expect((await readFile(join(root, ".tombstones"), "utf8")).trim()).toMatch(/^\{"feed":"bad","readId":"/);

    // The name is out of use: a post, a text or a picture, is 410; so is the read id for a new feed.
    const text = await call("POST", "/feeds/bad/notes", { body: "# again", headers: { "content-type": "text/markdown" } });
    expect(text.status).toBe(410);
    expect(await text.json()).toEqual({ error: "this feed was removed by the operator", code: "removed" });
    expect(await hasFeed("bad")).toBe(false);
    const taken = await call("POST", "/feeds/other/notes", { body: "# x", headers: { "content-type": "text/markdown", "x-read-id": rid } });
    expect(taken.status).toBe(409);
    expect((await taken.json()).code).toBe("taken");

    // The image is blocked in any feed, however it comes; another picture is fine.
    await createNote("elsewhere", "# ok");
    const blocked = await upload("elsewhere", PNG);
    expect(blocked.status).toBe(451);
    expect(await blocked.json()).toEqual({ error: "this image may not be posted here", code: "blocked" });
    const form = new FormData();
    form.append("text", "# with ![](a.png)");
    form.append("file", new File([PNG as BlobPart], "a.png", { type: "image/png" }));
    expect((await call("POST", "/feeds/elsewhere/notes", { body: form })).status).toBe(451);
    const fine = await (await upload("elsewhere", PNG2)).json();
    expect((await call("PUT", `/feeds/elsewhere/notes/${fine.id}`, { body: PNG as BodyInit, headers: { "content-type": "image/png" } })).status).toBe(451);
    expect((await call("GET", "/feeds/elsewhere/notes")).status).toBe(200);
    expect((await (await call("GET", "/feeds/elsewhere/notes")).json()).notes).toHaveLength(2);
  });

  test("a read id nobody has is 404, one removed before is already_removed, a bad body 400, the gate as elsewhere", async () => {
    await createNote("bad", "# text");
    const rid = (await readIdOf("bad"))!;
    expect((await takedown("https://x.test/r/nobody-has-this")).status).toBe(404);
    expect((await takedown(rid)).status).toBe(200);
    const again = await takedown(`/r/${rid}/feed.xml`);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ removed: false, already_removed: true });
    expect((await takedown("https://x.test/feedname")).status).toBe(400);
    expect((await takedown(42)).status).toBe(400);
    expect((await takedown(rid, "Bearer wrong")).status).toBe(401);
    vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", "");
    expect((await takedown(rid)).status).toBe(404);
  });

  test("the tombstones and the blocklist survive a restart, and a folder that came back is removed again", async () => {
    await createNote("bad", "# text");
    await upload("bad", PNG);
    await takedown((await readIdOf("bad"))!);
    await createNote("good", "# stays");
    resetFeedsForTests(); // as a restart: the index is read from disk again
    expect(await isRemovedFeed("bad")).toBe(true);
    expect(await hasFeed("good")).toBe(true);
    expect((await upload("good", PNG)).status).toBe(451);
    // A restore by hand brings the folder back: not a feed, and gone at the next start.
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(root, "bad"));
    await writeFile(join(root, "bad", ".readid"), "some-id-xyz");
    resetFeedsForTests();
    expect(await hasFeed("bad")).toBe(false);
    expect((await readdir(root)).filter((n) => !n.startsWith("."))).toEqual(["good"]);
  });
});
