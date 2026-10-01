import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { login } from "../auth";
import { cookieValue } from "../feedlock";
import { resetFeedsForTests, readIdOf } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { createNote } from "../notes";
import { API_PREFIX, dispatch } from "./api";
import { rssRoute } from "./rss";

const BASE = "http://localhost:3000";
beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-api-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL", "NOTEFEED_TITLE"]) delete process.env[k];
});

// Through the dispatcher, which (outside production) checks every reply against what its entry declares.
async function call(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
  const url = new URL(API_PREFIX + path, BASE);
  const segments = url.pathname.slice(API_PREFIX.length + 1).split("/").map(decodeURIComponent);
  return dispatch(new Request(url, { method, body: init.body, headers: { host: "localhost:3000", ...init.headers } }), segments);
}
const json = async (res: Response) => res.json();
const post = (feed: string, markdown: string, headers: Record<string, string> = {}) =>
  call("POST", `/feeds/${feed}/notes`, { body: markdown, headers: { "content-type": "text/markdown", ...headers } });

describe("POST /feeds/{feed}/notes", () => {
  test("201 with links, like POST /<feed>", async () => {
    const res = await post("backups", "# Hi");
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.read_url).toBe(`${BASE}/r/${(await readIdOf("backups"))!}/feed.xml`);
  });
  test("errors carry a code", async () => {
    expect(await json(await post("backups", "  "))).toEqual({ error: "note is empty", code: "empty_note" });
    expect(await json(await post("login", "x"))).toEqual({ error: "feed name is reserved", code: "reserved_feed" });
  });
});

describe("GET /feeds/{feed}/notes", () => {
  test("newest first, as JSON notes with their web UI links", async () => {
    await createNote("backups", "# One\nbody", new Date("2026-09-29T10:00:00Z"));
    await createNote("backups", "# Two", new Date("2026-09-29T11:00:00Z"));
    const body = await json(await call("GET", "/feeds/backups/notes"));
    expect(body.next).toBeNull();
    expect(body.notes).toEqual([
      expect.objectContaining({ id: "20260929T110000Z-two", title: "Two", created_at: "2026-09-29T11:00:00.000Z" }),
      {
        id: "20260929T100000Z-one",
        title: "One",
        markdown: "# One\nbody",
        created_at: "2026-09-29T10:00:00.000Z",
        url: `${BASE}/backups/20260929T100000Z-one`,
      },
    ]);
  });

  test("pages with limit and before, until next is null", async () => {
    for (let h = 10; h < 15; h++) await createNote("backups", `# N${h}`, new Date(`2026-09-29T${h}:00:00Z`));
    const seen: string[] = [];
    let before: string | null = "";
    while (before !== null) {
      const body = await json(await call("GET", `/feeds/backups/notes?limit=2${before ? `&before=${before}` : ""}`));
      seen.push(...body.notes.map((n: { title: string }) => n.title));
      before = body.next;
    }
    expect(seen).toEqual(["N14", "N13", "N12", "N11", "N10"]);
  });

  test("a feed without notes is an empty list", async () => {
    expect(await json(await call("GET", "/feeds/nothing-here/notes"))).toEqual({ notes: [], next: null });
  });

  test.each(["limit=0", "limit=101", "limit=x", "before=../x"])("400 invalid_request for %s", async (q) => {
    const res = await call("GET", `/feeds/backups/notes?${q}`);
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("invalid_request");
  });

  test("400 for an invalid or reserved name, including an encoded slash", async () => {
    for (const [feed, code] of [["Bad", "invalid_feed"], ["api", "reserved_feed"], ["a%2Fb", "invalid_feed"]]) {
      const res = await call("GET", `/feeds/${feed}/notes`);
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe(code);
    }
  });

  test("the password and the name are checked before the query", async () => {
    expect((await json(await call("GET", "/feeds/Bad/notes?limit=0"))).code).toBe("invalid_feed");
    process.env.NOTEFEED_PASSWORD = "pw";
    expect((await call("GET", "/feeds/backups/notes?limit=0")).status).toBe(401);
    expect((await call("GET", "/feeds/backups/notes/20260101T000000Z-x")).status).toBe(401);
  });

  test("locked: needs the bearer password", async () => {
    process.env.NOTEFEED_PASSWORD = "pw";
    expect((await call("GET", "/feeds/backups/notes")).status).toBe(401);
    expect((await call("GET", "/feeds/backups/notes", { headers: { authorization: "Bearer pw" } })).status).toBe(200);
  });
});

test("a percent-encoded or non-ASCII feed name is a 400 invalid_feed", async () => {
  for (const feed of ["a%2Fb", "%E2%9C%93"]) {
    for (const res of [await call("GET", `/feeds/${feed}/notes`), await post(feed, "# Hi")]) {
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe("invalid_feed");
    }
  }
});

describe("GET /feeds/{feed}/notes/{id}", () => {
  test("one note, or 404", async () => {
    const n = await createNote("backups", "# Hi");
    expect((await json(await call("GET", `/feeds/backups/notes/${n.id}`))).markdown).toBe("# Hi");
    const res = await call("GET", "/feeds/backups/notes/20260101T000000Z-nope");
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe("not_found");
  });
  test("locked: 401 without the password", async () => {
    const n = await createNote("backups", "# Hi");
    process.env.NOTEFEED_PASSWORD = "pw";
    expect((await call("GET", `/feeds/backups/notes/${n.id}`)).status).toBe(401);
  });
});

describe("GET /read/{readId}/notes", () => {
  test("the feed's notes, linking to the read-only pages, never naming the feed; public when locked", async () => {
    await createNote("secretname", "# Shared");
    process.env.NOTEFEED_PASSWORD = "pw";
    const rid = (await readIdOf("secretname"))!;
    const res = await call("GET", `/read/${rid}/notes`);
    const text = await res.clone().text();
    expect(text).not.toContain("secretname");
    expect((await json(res)).notes[0].url).toMatch(new RegExp(`^${BASE}/r/${rid}/\\d{8}T\\d{6}Z-shared$`));
  });
  test("an unknown read id is an empty list; a malformed one 404", async () => {
    expect(await json(await call("GET", `/read/${"A".repeat(22)}/notes`))).toEqual({ notes: [], next: null });
    expect((await call("GET", "/read/short/notes")).status).toBe(404);
  });
  test("one note by read id, or 404", async () => {
    const n = await createNote("secretname", "# Shared");
    expect((await json(await call("GET", `/read/${(await readIdOf("secretname"))!}/notes/${n.id}`))).title).toBe("Shared");
    expect((await call("GET", `/read/${"A".repeat(22)}/notes/${n.id}`)).status).toBe(404);
  });
});

test("unknown endpoints are a JSON 404, wrong methods a 405 with Allow", async () => {
  const unknown = await dispatch(new Request(`${BASE}/api/v1/nope`), ["nope"]);
  expect(unknown.status).toBe(404);
  expect((await json(unknown)).code).toBe("not_found");
  const wrong = await call("POST", `/read/${"A".repeat(22)}/notes`);
  expect(wrong.status).toBe(405);
  expect(wrong.headers.get("allow")).toBe("GET, HEAD");
});

describe("the OpenAPI document", () => {
  test("is served with this instance's public URL", async () => {
    process.env.PUBLIC_URL = "https://notes.example";
    const doc = await json(await call("GET", "/openapi.json"));
    expect(doc.openapi).toBe("3.1.1");
    expect(doc.servers).toEqual([{ url: "https://notes.example" }]);
  });
});

// Every error each entry can raise reaches the client with that status (the dispatcher turns an
// undeclared one into a 500, so these fail if an entry starts throwing something it doesn't declare).
describe("each entry's errors arrive with their declared status", () => {
  const feedNote = async () => (await createNote("backups", "# Hi")).id;
  const locked = (rate = "60") => {
    process.env.NOTEFEED_PASSWORD = "pw";
    process.env.NOTEFEED_RATE_LIMIT = rate;
  };
  const wrong = { authorization: "Bearer nope" };

  test.each([
    ["listNotes", async () => "/feeds/backups/notes"],
    ["getNote", async () => `/feeds/backups/notes/${await feedNote()}`],
  ])("%s: 401 for a wrong password or a cross-site session cookie, then 429 with Retry-After", async (_, path) => {
    const p = await path();
    locked("2");
    const cookie = { cookie: `nf_session=${login("pw", "x")}`, origin: "https://evil.example" };
    expect((await call("GET", p, { headers: cookie })).status).toBe(401);
    expect((await call("GET", p, { headers: wrong })).status).toBe(401);
    const res = await call("GET", p, { headers: wrong });
    expect(res.status).toBe(429);
    expect((await json(res)).code).toBe("too_many_attempts");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  test("getNote: 400 for a reserved feed, 404 for an unknown note", async () => {
    expect((await json(await call("GET", "/feeds/api/notes/20260101T000000Z-x"))).code).toBe("reserved_feed");
    expect((await call("GET", "/feeds/backups/notes/20260101T000000Z-x")).status).toBe(404);
  });

  test("getReadNote: 404 for a malformed read id", async () => {
    expect((await call("GET", `/read/short/notes/${await feedNote()}`)).status).toBe(404);
  });

  test("postNote: 401, 413, 415, 429 and 507 through the API", async () => {
    process.env.NOTEFEED_MAX_FEEDS = "1";
    try {
      expect((await post("backups", "# One")).status).toBe(201);
      expect((await json(await post("other", "# Two"))).code).toBe("feed_limit");
      expect((await post("backups", "x".repeat(102401))).status).toBe(413);
      expect((await call("POST", "/feeds/backups/notes", { body: "x", headers: { "content-type": "image/png" } })).status).toBe(415);
      locked("1");
      expect((await post("backups", "# Hi", wrong)).status).toBe(401);
      expect((await post("backups", "# Hi", wrong)).status).toBe(429);
    } finally {
      delete process.env.NOTEFEED_MAX_FEEDS;
    }
  });
});

describe("feed passwords", () => {
  const fp = { "x-feed-password": "pw" };
  let id: string;
  beforeEach(async () => {
    const res = await post("locked", "# Hi", fp);
    expect(res.status).toBe(201);
    id = (await json(res)).id;
  });

  test("list and get need the feed password", async () => {
    for (const path of ["/feeds/locked/notes", `/feeds/locked/notes/${id}`]) {
      const res = await call("GET", path);
      expect(res.status).toBe(401);
      expect((await json(res)).code).toBe("auth");
      expect((await call("GET", path, { headers: fp })).status).toBe(200);
    }
  });

  test("requests without a password are refused but not counted; wrong passwords are", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "3";
    for (let i = 0; i < 5; i++) expect((await call("GET", "/feeds/locked/notes")).status).toBe(401);
    for (let i = 0; i < 5; i++) expect((await call("GET", "/feeds/locked/notes", { headers: { "x-feed-password": "" } })).status).toBe(401);
    expect((await call("DELETE", "/feeds/locked/password")).status).toBe(401);
    expect((await call("GET", "/feeds/locked/notes", { headers: fp })).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await call("GET", "/feeds/locked/notes", { headers: { "x-feed-password": "nope" } })).status).toBe(401);
    const res = await call("GET", "/feeds/locked/notes", { headers: fp });
    expect(res.status).toBe(429);
    expect((await json(res)).code).toBe("too_many_attempts");
  });

  test("read links never need it", async () => {
    const rid = (await readIdOf("locked"))!;
    expect((await call("GET", `/read/${rid}/notes`)).status).toBe(200);
    expect((await call("GET", `/read/${rid}/notes/${id}`)).status).toBe(200);
    for (const method of ["GET", "HEAD"])
      expect((await rssRoute(new Request(`${BASE}/r/${rid}/feed.xml`, { method, headers: { host: "localhost:3000" } }), rid)).status).toBe(200);
  });

  test("with the instance lock too, both are needed", async () => {
    process.env.NOTEFEED_PASSWORD = "inst";
    const bearer = { authorization: "Bearer inst" };
    expect((await call("GET", "/feeds/locked/notes", { headers: bearer })).status).toBe(401);
    expect((await call("GET", "/feeds/locked/notes", { headers: fp })).status).toBe(401);
    expect((await call("GET", "/feeds/locked/notes", { headers: { ...bearer, ...fp } })).status).toBe(200);
  });

  test("an open feed: the header is ignored on GET, 409 on POST", async () => {
    await createNote("open", "# Hi");
    expect((await call("GET", "/feeds/open/notes", { headers: fp })).status).toBe(200);
    const res = await post("open", "# Claim", fp);
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe("feed_exists");
  });

  const put = (feed: string, password: string, headers: Record<string, string> = fp) =>
    call("PUT", `/feeds/${feed}/password`, { body: JSON.stringify({ password }), headers: { "content-type": "application/json", ...headers } });

  test("PUT changes it with the current password", async () => {
    expect((await put("locked", "new", { "x-feed-password": "nope" })).status).toBe(401);
    for (const bad of ["", "x".repeat(257), "pässwort", " lead", "trail "]) {
      const res = await put("locked", bad);
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe("invalid_body");
      expect((await call("GET", "/feeds/locked/notes", { headers: fp })).status).toBe(200);
    }
    const ok = await put("locked", "new");
    expect(ok.status).toBe(204);
    expect((await call("GET", "/feeds/locked/notes", { headers: fp })).status).toBe(401);
    expect((await call("GET", "/feeds/locked/notes", { headers: { "x-feed-password": "new" } })).status).toBe(200);
  });

  test("PUT and DELETE on an open feed: 409", async () => {
    await createNote("open", "# Hi");
    expect((await put("open", "new")).status).toBe(409);
    expect((await call("DELETE", "/feeds/open/password", { headers: fp })).status).toBe(409);
  });

  test("DELETE removes it with the current password; the feed is open again", async () => {
    expect((await call("DELETE", "/feeds/locked/password", { headers: { "x-feed-password": "nope" } })).status).toBe(401);
    expect((await call("DELETE", "/feeds/locked/password", { headers: fp })).status).toBe(204);
    expect((await call("GET", "/feeds/locked/notes")).status).toBe(200);
    expect((await post("locked", "# Open")).status).toBe(201);
  });
});

describe("editing and deleting notes", () => {
  const md = { "content-type": "text/markdown" };
  const put = (path: string, body: string, headers: Record<string, string> = {}) => call("PUT", path, { body, headers: { ...md, ...headers } });
  const make = async (feed = "backups", headers: Record<string, string> = {}) => (await json(await post(feed, "# Old", headers))).id as string;
  const markdownOf = async (feed: string, id: string, headers: Record<string, string> = {}) => (await json(await call("GET", `/feeds/${feed}/notes/${id}`, { headers }))).markdown;

  test("PUT with markdown or JSON: 200, same id and created_at, new title, readable everywhere", async () => {
    const id = await make();
    const before = await json(await call("GET", `/feeds/backups/notes/${id}`));
    const res = await put(`/feeds/backups/notes/${id}`, "# New");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ...before, title: "New", markdown: "# New" });
    const viaJson = await put(`/feeds/backups/notes/${id}`, JSON.stringify({ markdown: "# Json" }), { "content-type": "application/json" });
    expect((await json(viaJson)).title).toBe("Json");
    expect(await markdownOf("backups", id)).toBe("# Json");
    expect((await json(await call("GET", `/read/${(await readIdOf("backups"))!}/notes/${id}`))).markdown).toBe("# Json");
  });

  test("PUT empty is 400 empty_note, over 100 KB is 413, both leave the note", async () => {
    const id = await make();
    expect((await json(await put(`/feeds/backups/notes/${id}`, "  "))).code).toBe("empty_note");
    expect((await put(`/feeds/backups/notes/${id}`, "x".repeat(102401))).status).toBe(413);
    expect(await markdownOf("backups", id)).toBe("# Old");
  });

  test("PUT and DELETE on an unknown or invalid id: 404; a reserved feed: 400", async () => {
    await make();
    for (const id of ["20260101T000000Z-x", "not-an-id", ".password"]) {
      expect((await put(`/feeds/backups/notes/${id}`, "# New")).status).toBe(404);
      const res = await call("DELETE", `/feeds/backups/notes/${id}`);
      expect(res.status).toBe(404);
      expect(await json(res)).toEqual({ error: "no such note", code: "not_found" });
    }
    expect((await call("DELETE", "/feeds/api/notes/20260101T000000Z-x")).status).toBe(400);
    expect((await put("/feeds/nofeed/notes/20260101T000000Z-x", "# New")).status).toBe(404);
  });

  test("DELETE: 204, then the note is gone from get and list", async () => {
    const id = await make();
    const res = await call("DELETE", `/feeds/backups/notes/${id}`);
    expect(res.status).toBe(204);
    expect((await call("GET", `/feeds/backups/notes/${id}`)).status).toBe(404);
    expect((await json(await call("GET", "/feeds/backups/notes"))).notes).toEqual([]);
  });

  test("a protected feed needs its password for both; deleting its last note keeps it protected", async () => {
    const fp = { "x-feed-password": "pw" };
    const id = await make("locked", fp);
    const path = `/feeds/locked/notes/${id}`;
    expect((await put(path, "# New")).status).toBe(401);
    expect((await call("DELETE", path)).status).toBe(401);
    expect((await put(path, "# New", fp)).status).toBe(200);
    expect(await markdownOf("locked", id, fp)).toBe("# New");
    expect((await call("DELETE", path, { headers: fp })).status).toBe(204);
    expect((await post("locked", "# Again")).status).toBe(401);
  });

  test("the feed cookie authorises PUT and DELETE only from this instance's own pages", async () => {
    const id = await make("locked", { "x-feed-password": "pw" });
    const path = `/feeds/locked/notes/${id}`;
    const cookie = `nf_feed_locked=${await cookieValue("locked")}`;
    for (const origin of [{} as Record<string, string>, { origin: "https://evil.example" }]) {
      expect((await put(path, "# Hacked", { cookie, ...origin })).status).toBe(401);
      expect((await call("DELETE", path, { headers: { cookie, ...origin } })).status).toBe(401);
    }
    const own = { cookie, origin: BASE };
    expect((await put(path, "# New", own)).status).toBe(200);
    expect((await call("DELETE", path, { headers: own })).status).toBe(204);
  });

  test("a missing feed password is refused before the body is read", async () => {
    const id = await make("locked", { "x-feed-password": "pw" });
    let pulled = false;
    const body = new ReadableStream({ pull: (c) => ((pulled = true), c.close()) }, { highWaterMark: 0 });
    const req = new Request(`${BASE}${API_PREFIX}/feeds/locked/notes/${id}`, { method: "PUT", body, headers: { host: "localhost:3000", ...md }, duplex: "half" } as RequestInit);
    expect((await dispatch(req, ["feeds", "locked", "notes", id])).status).toBe(401);
    expect(pulled).toBe(false);
  });

  test("the instance password is needed first", async () => {
    const id = await make();
    process.env.NOTEFEED_PASSWORD = "pw";
    const path = `/feeds/backups/notes/${id}`;
    expect((await put(path, "# New")).status).toBe(401);
    expect((await call("DELETE", path)).status).toBe(401);
    expect((await call("DELETE", path, { headers: { authorization: "Bearer pw" } })).status).toBe(204);
  });

  test("edits and deletes count against the post rate limit", async () => {
    const id = await make();
    process.env.NOTEFEED_RATE_LIMIT = "1";
    resetRateLimitsForTests();
    expect((await post("backups", "# Two")).status).toBe(201);
    const res = await put(`/feeds/backups/notes/${id}`, "# New");
    expect(res.status).toBe(429);
    expect((await call("DELETE", `/feeds/backups/notes/${id}`)).status).toBe(429);
    expect(await markdownOf("backups", id)).toBe("# Old");
  });

  test("the read paths answer 405 to PUT and DELETE", async () => {
    const id = await make();
    for (const method of ["PUT", "DELETE"]) expect((await call(method, `/read/${(await readIdOf("backups"))!}/notes/${id}`)).status).toBe(405);
  });
});
