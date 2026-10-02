import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { encode, decode } from "../data/frontmatter";
import { resetFeedsForTests, readIdOf } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { getNote } from "../notes";
import { editNote } from "../posting";
import { checkTags, tagsFromHeader } from "../tags";
import { dispatch } from "./api";
import { rssRoute } from "./rss";

const BASE = "http://localhost:3000";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-tags-"));
  process.env.DATA_DIR = dir;
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  for (const k of ["NOTEFEED_RATE_LIMIT", "NOTEFEED_PASSWORD", "PUBLIC_URL"]) delete process.env[k];
});

const send = (path: string[], init: RequestInit = {}, query = "") =>
  dispatch(new Request(`${BASE}/${path.join("/")}${query}`, { ...init, headers: { host: "localhost:3000", ...init.headers } }), path);
const post = (body: BodyInit, headers: Record<string, string> = {}) => send(["feeds", "t", "notes"], { method: "POST", body, headers });
const json = (tags: unknown, markdown = "# Hi") => post(JSON.stringify({ markdown, tags }), { "content-type": "application/json" });
const list = async (query = "") => (await (await send(["feeds", "t", "notes"], {}, query)).json()).notes as { id: string; tags: string[] }[];

describe("checkTags", () => {
  test("folds case, drops duplicates, keeps order", () => expect(checkTags(["CI", "env:prod", "ci"])).toEqual(["ci", "env:prod"]));
  test.each([[["has space"]], [[""]], [["x".repeat(33)]], [["ü"]], [Array.from({ length: 11 }, (_, i) => `t${i}`)]])("refuses %j", (tags) => {
    expect(() => checkTags(tags)).toThrow(/tag/);
  });
  test("header form: comma-separated, trimmed, empty is none", () => {
    expect(tagsFromHeader("ci, deploy,,")).toEqual(["ci", "deploy"]);
    expect(tagsFromHeader("")).toEqual([]);
    expect(tagsFromHeader(null)).toBeUndefined();
  });
});

describe("posting tags", () => {
  test("JSON body, stored in the frontmatter and read back", async () => {
    const res = await json(["CI", "env:prod"]);
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(await readFile(join(dir, "t", `${id}.md`), "utf8")).toBe('---\ntags: ["ci","env:prod"]\n---\n# Hi');
    expect((await getNote("t", id))!.tags).toEqual(["ci", "env:prod"]);
  });
  test("X-Note-Tags header on a raw body", async () => {
    await post("# Raw", { "x-note-tags": "ci,Deploy" });
    expect((await list())[0].tags).toEqual(["ci", "deploy"]);
  });
  test("a repeated multipart field", async () => {
    const f = new FormData();
    f.append("markdown", "# Form");
    f.append("tags", "a");
    f.append("tags", "b");
    await post(f);
    expect((await list())[0].tags).toEqual(["a", "b"]);
  });
  test("no tags is an empty list and no frontmatter key", async () => {
    const { id } = await (await post("# Plain")).json();
    expect(await readFile(join(dir, "t", `${id}.md`), "utf8")).toBe("---\n---\n# Plain");
    expect((await list())[0].tags).toEqual([]);
  });
  test("an invalid tag is a 400 and posts nothing", async () => {
    const res = await json(["bad tag"]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid tag "bad tag"/);
    expect(await list()).toEqual([]);
  });
  test("an invalid tag does not leave a protected feed behind", async () => {
    const res = await post(JSON.stringify({ markdown: "# x", tags: ["no good"], password: "secret1" }), { "content-type": "application/json" });
    expect(res.status).toBe(400);
    expect((await send(["feeds", "t"], {})).status).not.toBe(200);
  });
  test("an edit keeps the tags", async () => {
    const { id } = await (await json(["keep"])).json();
    await editNote("t", id, "1.2.3.4", async () => ({ markdown: "# Changed" }), {});
    expect((await getNote("t", id))!.tags).toEqual(["keep"]);
  });
});

describe("filtering", () => {
  test("?tag= on the list, case-folded, with paging", async () => {
    for (const [i, tags] of [["a"], ["b"], ["a", "b"], ["a"]].entries()) {
      await post(`# n${i}`, { "x-note-tags": tags.join(",") });
      await new Promise((r) => setTimeout(r, 1100)); // ids are to the second
    }
    expect((await list("?tag=A")).map((n) => n.tags)).toEqual([["a"], ["a", "b"], ["a"]]);
    const page = await (await send(["feeds", "t", "notes"], {}, "?tag=a&limit=2")).json();
    expect(page.notes).toHaveLength(2);
    expect(page.next).toBe(page.notes[1].id);
    expect(await list("?tag=none")).toEqual([]);
    expect((await send(["feeds", "t", "notes"], {}, "?tag=bad%20tag")).status).toBe(400);
  }, 15000);

  test("RSS: <category> per tag, and ?tag= narrows the feed", async () => {
    await post("# One", { "x-note-tags": "ci,env:prod" });
    await new Promise((r) => setTimeout(r, 1100));
    await post("# Two");
    const rid = (await readIdOf("t"))!;
    const get = async (q = "") => (await rssRoute(new Request(`${BASE}/r/${rid}/feed.xml${q}`, { headers: { host: "localhost:3000" } }), rid)).text();
    const all = await get();
    expect(all).toContain("<category>ci</category>");
    expect(all).toContain("<category>env:prod</category>");
    const only = await get("?tag=CI");
    expect(only).toContain("One");
    expect(only).not.toContain("Two");
  }, 15000);
});

test("the frontmatter round-trips a tags key", () => {
  expect(decode(encode("body", { tags: ["a", "b"] }))).toEqual({ markdown: "body", meta: { tags: ["a", "b"] } });
});
