import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { readIdOf, resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { createNote } from "../notes";
import { API_PREFIX, dispatch } from "./api";
import { rssRoute } from "./rss";

const BASE = "http://localhost:3000";
let dir: string;
beforeEach(async () => {
  dir = process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-feeds-api-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL", "NOTEFEED_TITLE"]) delete process.env[k];
});

async function call(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
  const url = new URL(API_PREFIX + path, BASE);
  const segments = url.pathname.slice(API_PREFIX.length + 1).split("/").map(decodeURIComponent);
  return dispatch(new Request(url, { method, body: init.body, headers: { host: "localhost:3000", ...init.headers } }), segments);
}
const put = (feed: string, settings: unknown, headers: Record<string, string> = {}) =>
  call("PUT", `/feeds/${feed}`, { body: JSON.stringify(settings), headers: { "content-type": "application/json", ...headers } });
const post = (feed: string, markdown: string, headers: Record<string, string> = {}) =>
  call("POST", `/feeds/${feed}/notes`, { body: markdown, headers: { "content-type": "text/markdown", ...headers } });
const exists = (p: string) => stat(join(dir, p)).then(() => true, () => false);

describe("settings", () => {
  test("PUT then GET, then the read API and the RSS channel show them", async () => {
    await createNote("mine", "# Hi");
    const res = await put("mine", { title: "My <feed> & ]]> 🎉", description: "About <b>it</b> & more" });
    expect(res.status).toBe(200);
    const rid = (await readIdOf("mine"))!;
    const want = { name: "mine", title: "My <feed> & ]]> 🎉", description: "About <b>it</b> & more", protected: false, read_url: `${BASE}/r/${rid}/feed.xml`, image_url: null, show_sender: true };
    expect(await res.json()).toEqual(want);
    expect(await (await call("GET", "/feeds/mine")).json()).toEqual(want);
    expect(await (await call("GET", `/read/${rid}`)).json()).toEqual({ title: want.title, description: want.description, image_url: null });
    const xml = await (await rssRoute(new Request(`${BASE}/r/${rid}/feed.xml`, { headers: { host: "localhost:3000" } }), rid)).text();
    expect(xml).toContain("<title>My &lt;feed&gt; &amp; ]]&gt; 🎉</title>");
    expect(xml).toContain("<description>About &lt;b&gt;it&lt;/b&gt; &amp; more</description>");
    expect(xml).not.toContain("mine");
  });

  test("show_sender: stored, returned, kept when omitted, non-boolean is a 400", async () => {
    await createNote("mine", "# Hi");
    expect((await (await put("mine", { title: "", description: "", show_sender: false })).json()).show_sender).toBe(false);
    expect((await (await call("GET", "/feeds/mine")).json()).show_sender).toBe(false);
    expect((await (await put("mine", { title: "T", description: "" })).json()).show_sender).toBe(false);
    expect((await put("mine", { title: "", description: "", show_sender: "no" })).status).toBe(400);
    expect((await (await put("mine", { title: "", description: "", show_sender: true })).json()).show_sender).toBe(true);
  });

  test("the channel falls back to the default title, and the description to the title", async () => {
    await createNote("mine", "# Hi");
    const rid = (await readIdOf("mine"))!;
    const xml = await (await rssRoute(new Request(`${BASE}/r/${rid}/feed.xml`, { headers: { host: "localhost:3000" } }), rid)).text();
    expect(xml).toContain("<title>notefeed</title>");
    expect(xml).toContain("<description>notefeed</description>");
  });

  test("a feed with no notes has no read_url; settings default to empty", async () => {
    await createNote("mine", "x");
    await (await import("../notes")).removeNote("mine", (await (await call("GET", "/feeds/mine/notes")).json()).notes[0].id);
    expect(await (await call("GET", "/feeds/mine")).json()).toEqual({ name: "mine", title: "", description: "", protected: false, read_url: null, image_url: null, show_sender: true });
  });

  test("whitespace is trimmed", async () => {
    await createNote("mine", "x");
    expect(await (await put("mine", { title: "  T  ", description: "\t D \n" })).json()).toMatchObject({ title: "T", description: "D" });
  });

  test("empty values clear the settings", async () => {
    await createNote("mine", "x");
    await put("mine", { title: "T", description: "D" });
    expect(await (await put("mine", { title: "", description: "" })).json()).toMatchObject({ title: "", description: "" });
  });

  test.each([
    ["title of 101 characters", { title: "x".repeat(101), description: "" }],
    ["description of 501", { title: "", description: "x".repeat(501) }],
    ["control character in title", { title: "a\u0007b", description: "" }],
    ["newline in description", { title: "", description: "a\nb" }],
    ["DEL", { title: "a\x7fb", description: "" }],
    ["missing field", { title: "x" }],
    ["wrong type", { title: 1, description: "" }],
    ["not an object", ["x"]],
  ])("400 invalid_body for %s, nothing saved", async (_n, body) => {
    await createNote("mine", "x");
    await put("mine", { title: "keep", description: "keep" });
    const res = await put("mine", body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
    expect(await (await call("GET", "/feeds/mine")).json()).toMatchObject({ title: "keep", description: "keep" });
  });

  test("100 title characters, 500 description characters, and emoji count once", async () => {
    await createNote("mine", "x");
    expect((await put("mine", { title: "🎉".repeat(100), description: "x".repeat(500) })).status).toBe(200);
  });

  test("bad JSON → 400", async () => {
    await createNote("mine", "x");
    const res = await call("PUT", "/feeds/mine", { body: "{nope", headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
  });

  test("404 no such feed, and no directory is created", async () => {
    for (const res of [await put("ghost", { title: "", description: "" }), await call("GET", "/feeds/ghost"), await call("DELETE", "/feeds/ghost")]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "no such feed", code: "not_found" });
    }
    expect(await exists("ghost")).toBe(false);
    expect((await readdir(dir)).filter((n) => !n.startsWith("."))).toEqual([]);
  });

  test("an invalid or reserved name is 400", async () => {
    expect((await put("login", { title: "", description: "" })).status).toBe(400);
    expect((await call("GET", "/feeds/login")).status).toBe(400);
  });

  test("a protected feed needs its password for GET, PUT and DELETE", async () => {
    await post("locked", "# x", { "x-feed-password": "correct horse" });
    const fp = { "x-feed-password": "correct horse" };
    for (const [m, p] of [["GET", "/feeds/locked"], ["DELETE", "/feeds/locked"]] as const) expect((await call(m, p)).status).toBe(401);
    expect((await put("locked", { title: "t", description: "" })).status).toBe(401);
    expect((await put("locked", { title: "t", description: "" }, { "x-feed-password": "nope" })).status).toBe(401);
    expect((await call("GET", "/feeds/locked", { headers: fp })).json()).resolves.toMatchObject({ protected: true, title: "" });
    expect((await put("locked", { title: "t", description: "" }, fp)).status).toBe(200);
    // the public read side shows the title but never asks for a password
    const rid = (await readIdOf("locked"))!;
    expect(await (await call("GET", `/read/${rid}`)).json()).toEqual({ title: "t", description: "", image_url: null });
  });

  test("a locked instance needs the bearer password", async () => {
    await createNote("mine", "x");
    process.env.NOTEFEED_PASSWORD = "inst";
    const bearer = { authorization: "Bearer inst" };
    expect((await put("mine", { title: "", description: "" })).status).toBe(401);
    expect((await call("GET", "/feeds/mine")).status).toBe(401);
    expect((await call("DELETE", "/feeds/mine")).status).toBe(401);
    expect((await put("mine", { title: "t", description: "" }, bearer)).status).toBe(200);
    expect((await call("GET", "/feeds/mine", { headers: bearer })).status).toBe(200);
    expect((await call("DELETE", "/feeds/mine", { headers: bearer })).status).toBe(204);
  });

  test("the post rate limit applies to PUT and DELETE", async () => {
    await createNote("mine", "x");
    process.env.NOTEFEED_RATE_LIMIT = "2";
    expect((await put("mine", { title: "a", description: "" })).status).toBe(200);
    expect((await put("mine", { title: "b", description: "" })).status).toBe(200);
    expect((await put("mine", { title: "c", description: "" })).status).toBe(429);
    expect((await call("DELETE", "/feeds/mine")).status).toBe(429);
  });

  test("an unknown read id has empty settings, a malformed one is 404", async () => {
    expect(await (await call("GET", `/read/${"A".repeat(22)}`)).json()).toEqual({ title: "", description: "", image_url: null });
    expect((await call("GET", "/read/ab")).status).toBe(404);
  });

  test("a corrupt .feed.json reads as empty", async () => {
    await createNote("mine", "x");
    await writeFile(join(dir, "mine", ".feed.json"), "{nope");
    expect(await (await call("GET", "/feeds/mine")).json()).toMatchObject({ title: "", description: "" });
  });
});

describe("DELETE /feeds/{feed}", () => {
  test("removes everything; the old read id is empty; the name is free and gets a new id", async () => {
    await post("doomed", "# one", { "x-feed-password": "correct horse" });
    await put("doomed", { title: "T", description: "D" }, { "x-feed-password": "correct horse" });
    const old = (await readIdOf("doomed"))!;
    const res = await call("DELETE", "/feeds/doomed", { headers: { "x-feed-password": "correct horse" } });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await exists("doomed")).toBe(false);
    expect((await readdir(dir)).filter((n) => n.startsWith(".deleted-"))).toEqual([]);
    expect((await call("GET", "/feeds/doomed")).status).toBe(404);
    expect(await (await call("GET", "/feeds/doomed/notes")).json()).toEqual({ notes: [], next: null });
    expect(await (await call("GET", `/read/${old}/notes`)).json()).toEqual({ notes: [], next: null });
    expect(await (await call("GET", `/read/${old}`)).json()).toEqual({ title: "", description: "", image_url: null });
    expect((await call("DELETE", "/feeds/doomed", { headers: { "x-feed-password": "correct horse" } })).status).toBe(404);

    expect((await post("doomed", "# again", { "x-feed-password": "another pass" })).status).toBe(201);
    expect((await readIdOf("doomed"))).not.toBe(old);
    expect(await (await call("GET", "/feeds/doomed", { headers: { "x-feed-password": "another pass" } })).json()).toMatchObject({ title: "", description: "" });
    expect((await call("GET", "/feeds/doomed/notes", { headers: { "x-feed-password": "correct horse" } })).status).toBe(401);
    expect(await (await call("GET", `/read/${old}/notes`)).json()).toEqual({ notes: [], next: null });
  });

  test("an open feed re-created has no password and no old settings", async () => {
    await post("again", "# one");
    await put("again", { title: "T", description: "D" });
    await call("DELETE", "/feeds/again");
    await post("again", "# two");
    expect(await (await call("GET", "/feeds/again")).json()).toMatchObject({ title: "", description: "", protected: false });
  });
});

describe("settings body", () => {
  test("a missing feed password is refused before the body is read", async () => {
    await post("locked", "# x", { "x-feed-password": "correct horse" });
    let pulled = false;
    const body = new ReadableStream({ pull: (c) => ((pulled = true), c.close()) }, { highWaterMark: 0 });
    const req = new Request(`${BASE}${API_PREFIX}/feeds/locked`, { method: "PUT", body, headers: { host: "localhost:3000", "content-type": "application/json" }, duplex: "half" } as RequestInit);
    expect((await dispatch(req, ["feeds", "locked"])).status).toBe(401);
    expect(pulled).toBe(false);
  });
});

describe("delete racing a creation", () => {
  const invariants = async (name: string, old: string) => {
    const { hasFeed, feedForReadId } = await import("../feeds");
    expect(await feedForReadId(old)).toBeNull();
    expect(await hasFeed(name)).toBe(await exists(name));
  };

  test("DELETE and POST through the API in the same tick: never a feed the index and the disk disagree on", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "0";
    for (let i = 0; i < 100; i++) {
      await createNote("race", "x");
      const old = (await readIdOf("race"))!;
      const [d, p] = await Promise.all([call("DELETE", "/feeds/race"), post("race", "# again")]);
      expect(d.status).toBe(204);
      expect(p.status).toBe(201);
      await invariants("race", old);
      expect((await post("race", "# next")).status).toBe(201);
      await call("DELETE", "/feeds/race");
    }
  });

  test("deleteFeed and ensureFeed in the same tick", async () => {
    const { deleteFeed, ensureFeed } = await import("../feeds");
    for (let i = 0; i < 200; i++) {
      await createNote("race", "x");
      const old = (await readIdOf("race"))!;
      await Promise.all([deleteFeed("race"), ensureFeed("race")]);
      await invariants("race", old);
      await createNote("race", "again"); // never a 500
      await deleteFeed("race");
    }
  });

  test("deleteFeed and createProtectedFeed in the same tick", async () => {
    const { deleteFeed, createProtectedFeed } = await import("../feeds");
    for (let i = 0; i < 200; i++) {
      await createNote("race", "x");
      const old = (await readIdOf("race"))!;
      await Promise.all([deleteFeed("race"), createProtectedFeed("race", "hash")]);
      await invariants("race", old);
      await deleteFeed("race");
    }
  });
});

describe("a feed whose directory was removed by hand while notefeed runs", () => {
  let id: string;
  beforeEach(async () => {
    id = (await createNote("hand", "# one")).note.id;
    await rm(join(dir, "hand"), { recursive: true });
  });
  const json = { "content-type": "application/json" };

  test("settings, a note's edit and delete, and the feed's delete answer 404, never 500", async () => {
    expect((await put("hand", { title: "T", description: "" })).status).toBe(404);
    expect((await call("PUT", `/feeds/hand/notes/${id}`, { body: JSON.stringify({ markdown: "# two" }), headers: json })).status).toBe(404);
    expect((await call("DELETE", `/feeds/hand/notes/${id}`)).status).toBe(404);
    expect((await call("PUT", "/feeds/hand/password", { body: JSON.stringify({ password: "new password" }), headers: { ...json, "x-feed-password": "x" } })).status).toBe(409); // "has no password"
    expect(await exists("hand")).toBe(false); // none of them made the directory again
    expect((await call("DELETE", "/feeds/hand")).status).toBe(404);
    expect((await call("GET", "/feeds/hand")).status).toBe(404); // the delete forgot it
  });

  test("a post makes the feed anew and answers with its new read link", async () => {
    const res = await post("hand", "# two");
    expect(res.status).toBe(201);
    expect((await res.json()).read_url).toBe(`${BASE}/r/${await readIdOf("hand")}/feed.xml`);
    expect((await readFile(join(dir, "hand", ".readid"), "utf8")).trim()).toBe(await readIdOf("hand"));
  });
});

describe("a feed without a read link (its .readid can't be read)", () => {
  test("a post answers 201 with read_url null, and so does the feed", async () => {
    await mkdir(join(dir, "nolink", ".readid"), { recursive: true });
    const res = await post("nolink", "# Hi");
    expect(res.status).toBe(201);
    expect((await res.json()).read_url).toBeNull();
    expect((await (await call("GET", "/feeds/nolink")).json()).read_url).toBeNull();
  });
});

describe("leftovers", () => {
  test("only .deleted-<12 hex> is removed", async () => {
    await mkdir(join(dir, ".deleted-keepme"));
    await createNote("real", "x");
    resetFeedsForTests();
    await readIdOf("real");
    expect(await exists(".deleted-keepme")).toBe(true);
  });

  test(".deleted-* is removed when the index loads and never listed", async () => {
    await createNote("real", "x");
    await mkdir(join(dir, ".deleted-0123456789ab"));
    await writeFile(join(dir, ".deleted-0123456789ab", "n.md"), "x");
    resetFeedsForTests();
    const { listFeeds, feedCount } = await import("../feeds");
    expect(await listFeeds()).toEqual(["real"]);
    expect(await feedCount()).toBe(1);
    expect(await exists(".deleted-0123456789ab")).toBe(false);
  });
});
