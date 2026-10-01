import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { resetFeedsForTests, readId } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { createNote } from "../notes";
import { API_PREFIX, dispatch } from "./api";

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
    expect(body.read_url).toBe(`${BASE}/r/${readId("backups")}/feed.xml`);
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
    const rid = readId("secretname");
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
    expect((await json(await call("GET", `/read/${readId("secretname")}/notes/${n.id}`))).title).toBe("Shared");
    expect((await call("GET", `/read/${"A".repeat(22)}/notes/${n.id}`)).status).toBe(404);
  });
});

test("unknown endpoints are a JSON 404, wrong methods a 405 with Allow", async () => {
  const unknown = await dispatch(new Request(`${BASE}/api/v1/nope`), ["nope"]);
  expect(unknown.status).toBe(404);
  expect((await json(unknown)).code).toBe("not_found");
  const wrong = await call("POST", `/read/${"A".repeat(22)}/notes`);
  expect(wrong.status).toBe(405);
  expect(wrong.headers.get("allow")).toBe("GET");
});

describe("the OpenAPI document", () => {
  test("is served with this instance's public URL", async () => {
    process.env.PUBLIC_URL = "https://notes.example";
    const doc = await json(await call("GET", "/openapi.json"));
    expect(doc.openapi).toBe("3.1.1");
    expect(doc.servers).toEqual([{ url: "https://notes.example" }]);
  });
});
