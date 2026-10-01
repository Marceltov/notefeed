import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  AuthError,
  Client,
  ConfigError,
  InvalidRequestError,
  LimitReachedError,
  NotefeedError,
  NotFoundError,
  NoteTooLargeError,
  RateLimitedError,
  type Note,
} from "../src/index.js";
import { fakeServer, type Recorded } from "./server.js";

let server: Awaited<ReturnType<typeof fakeServer>>;
beforeEach(async () => {
  server = await fakeServer();
});
afterEach(() => server.close());

const CREATED = {
  id: "20260930T100000Z-cafe",
  url: "https://n.example/inbox/20260930T100000Z-cafe",
  feed_url: "https://n.example/inbox",
  read_url: "https://n.example/r/AAAAAAAAAAAAAAAAAAAAAA/feed.xml",
};
const note = (h: number): Note => ({
  id: `20260930T${String(h).padStart(2, "0")}0000Z-n${h}`,
  title: `N${h}`,
  markdown: `# N${h}`,
  created_at: `2026-09-30T${String(h).padStart(2, "0")}:00:00.000Z`,
  url: `https://n.example/inbox/n${h}`,
});
const collect = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};
const url = (r: Recorded) => new URL(r.path, "http://x");

describe("post", () => {
  test("sends {markdown} as JSON to the feed and returns the created note", async () => {
    server.reply(201, CREATED);
    expect(await new Client({ url: server.url, feed: "inbox" }).post("# Café\r\nx")).toEqual(CREATED);
    const req = server.requests[0];
    expect([req.method, req.path]).toEqual(["POST", "/api/v1/feeds/inbox/notes"]);
    expect(JSON.parse(req.body.toString())).toEqual({ markdown: "# Café\r\nx" });
    expect(req.headers.authorization).toBeUndefined();
  });
  test("the password goes as a bearer; a per-call feed overrides the default", async () => {
    await new Client({ url: server.url, feed: "inbox", password: "pw" }).post("x", { feed: "other" });
    expect(server.requests[0].path).toBe("/api/v1/feeds/other/notes");
    expect(server.requests[0].headers.authorization).toBe("Bearer pw");
  });
  test("a base URL with a path prefix and a trailing slash keeps the prefix", async () => {
    await new Client({ url: `${server.url}/prefix/`, feed: "inbox" }).post("x");
    expect(server.requests[0].path).toBe("/prefix/api/v1/feeds/inbox/notes");
  });
});

describe("errors map from the response's code", () => {
  test.each([
    ["auth", 401, AuthError],
    ["rate_limited", 429, RateLimitedError],
    ["too_many_attempts", 429, RateLimitedError],
    ["not_found", 404, NotFoundError],
    ["feed_limit", 507, LimitReachedError],
    ["note_limit", 507, LimitReachedError],
    ["too_large", 413, NoteTooLargeError],
    ["invalid_feed", 400, InvalidRequestError],
    ["reserved_feed", 400, InvalidRequestError],
    ["empty_note", 400, InvalidRequestError],
    ["invalid_body", 400, InvalidRequestError],
    ["invalid_request", 400, InvalidRequestError],
    ["unsupported_type", 415, InvalidRequestError],
  ] as const)("%s → %s", async (code, status, cls) => {
    server.reply(status, { error: `because ${code}`, code });
    const e = await new Client({ url: server.url, feed: "inbox" }).post("x").catch((e: unknown) => e);
    expect(e).toBeInstanceOf(cls);
    expect(e).toMatchObject({ status, code, message: `because ${code}` });
  });
  test("RateLimitedError carries Retry-After", async () => {
    server.reply(429, { error: "slow down", code: "rate_limited" }, "application/json", { "Retry-After": "17" });
    const e = (await new Client({ url: server.url, feed: "inbox" }).post("x").catch((e: unknown) => e)) as RateLimitedError;
    expect(e.retryAfter).toBe(17);
  });
  test("an HTML 502 from a proxy is a NotefeedError with the status and no code", async () => {
    server.reply(502, "<html><body>Bad Gateway</body></html>", "text/html");
    const e = (await new Client({ url: server.url, feed: "inbox" }).post("x").catch((e: unknown) => e)) as NotefeedError;
    expect(e).toBeInstanceOf(NotefeedError);
    expect([e.status, e.code]).toEqual([502, null]);
    expect(e.message).toMatch(/^HTTP 502/);
  });
  test("an unreachable server is a NotefeedError without a status", async () => {
    await server.close();
    const e = (await new Client({ url: server.url, feed: "inbox", timeoutMs: 2000 }).post("x").catch((e: unknown) => e)) as NotefeedError;
    expect(e).toBeInstanceOf(NotefeedError);
    expect(e.status).toBeNull();
    expect(e.message).toMatch(/^could not reach/);
  });
});

describe("an answer that isn't the API's is an error, never a success", () => {
  test("a POST redirected (http → https) and turned into a GET loses nothing silently", async () => {
    server.route((r) =>
      r.method === "POST" ? [301, {}, { Location: "/api/v1/feeds/inbox/notes" }] : [200, { notes: [], next: null }],
    );
    const e = (await new Client({ url: server.url, feed: "inbox" }).post("x").catch((e: unknown) => e)) as NotefeedError;
    expect(e).toBeInstanceOf(NotefeedError);
    expect(e.message).toMatch(/redirect/);
  });
  test.each([
    ["an HTML page", "<html>hi</html>", "text/html"],
    ["invalid JSON", "{not json", "application/json"],
    ["JSON that isn't an object", "[1,2]", "application/json"],
  ])("a 2xx with %s", async (_, body, type) => {
    server.reply(201, body, type);
    const e = (await new Client({ url: server.url, feed: "inbox" }).post("x").catch((e: unknown) => e)) as NotefeedError;
    expect(e).toBeInstanceOf(NotefeedError);
    expect(e.message).toMatch(/unexpected response/);
  });
  test("notes() on a 200 HTML page is a NotefeedError, not a TypeError", async () => {
    server.reply(200, "<html>hi</html>", "text/html");
    await expect(collect(new Client({ url: server.url, feed: "inbox" }).notes())).rejects.toBeInstanceOf(NotefeedError);
  });
  test.each([
    ["an empty body", "", "HTTP 503"],
    ["a proxy's own JSON", JSON.stringify({ message: "upstream" }), 'HTTP 503: {"message":"upstream"}'],
  ])("an error with %s says what came back, not [object Object]", async (_, body, message) => {
    server.reply(503, body, "application/json");
    const e = (await new Client({ url: server.url, feed: "inbox" }).post("x").catch((e: unknown) => e)) as NotefeedError;
    expect(e.message).toBe(message);
  });
  test("a code that isn't a string is ignored", async () => {
    server.reply(400, { error: "odd", code: ["x"] });
    const e = (await new Client({ url: server.url, feed: "inbox" }).post("x").catch((e: unknown) => e)) as NotefeedError;
    expect(e.constructor).toBe(NotefeedError);
    expect(e.code).toBeNull();
  });
});

describe("config", () => {
  test.each(["Bad Name", "a/b", ""])("an invalid feed name %j is a ConfigError, and nothing is sent", async (feed) => {
    await expect(new Client({ url: server.url }).post("x", { feed: feed || undefined })).rejects.toBeInstanceOf(ConfigError);
    expect(server.requests).toHaveLength(0);
  });
  test("a password with a control character inside is a ConfigError (surrounding whitespace is trimmed)", () => {
    expect(() => new Client({ url: server.url, password: "p\nw" })).toThrow(ConfigError);
    expect(() => new Client({ url: server.url, password: "pw\n" })).not.toThrow();
  });
  test("no url is a ConfigError", () => {
    expect(() => new Client({ url: "" })).toThrow(ConfigError);
  });
  test("fromEnv reads NOTEFEED_URL, NOTEFEED_FEED and NOTEFEED_PASSWORD", async () => {
    const c = Client.fromEnv({ NOTEFEED_URL: server.url, NOTEFEED_FEED: "inbox", NOTEFEED_PASSWORD: "pw" });
    await c.post("x");
    expect(server.requests[0].path).toBe("/api/v1/feeds/inbox/notes");
    expect(server.requests[0].headers.authorization).toBe("Bearer pw");
  });
});

describe("reading", () => {
  // A feed of notes N10..N14 that pages by `before`, newest first, like the server.
  function serveFeed(notes: Note[]) {
    server.route((r) => {
      const q = url(r).searchParams;
      const limit = Number(q.get("limit") ?? 50);
      const older = [...notes].sort((a, b) => b.id.localeCompare(a.id)).filter((n) => !q.get("before") || n.id < q.get("before")!);
      const page = older.slice(0, limit);
      return [200, { notes: page, next: older.length > limit ? page[page.length - 1].id : null }];
    });
  }

  test("notes() walks every page via next → before, newest first", async () => {
    serveFeed([10, 11, 12, 13, 14].map(note));
    const got = await collect(new Client({ url: server.url, feed: "inbox" }).notes({ pageSize: 2 }));
    expect(got.map((n) => n.title)).toEqual(["N14", "N13", "N12", "N11", "N10"]);
    const pages = server.requests.map((r) => url(r));
    expect(pages.map((u) => u.pathname)).toEqual(Array(3).fill("/api/v1/feeds/inbox/notes"));
    expect(pages.map((u) => u.searchParams.get("before"))).toEqual([null, note(13).id, note(11).id]);
  });

  test("a note posted while paging is neither repeated nor yielded", async () => {
    const notes = [10, 11, 12, 13].map(note);
    serveFeed(notes);
    const seen: string[] = [];
    for await (const n of new Client({ url: server.url, feed: "inbox" }).notes({ pageSize: 2 })) {
      seen.push(n.title);
      if (seen.length === 1) notes.push(note(20)); // newer than everything already listed
    }
    expect(seen).toEqual(["N13", "N12", "N11", "N10"]);
  });

  test("note(id) and the read-id variants go to their endpoints", async () => {
    server.route(() => [200, note(10)]);
    const c = new Client({ url: server.url, feed: "inbox" });
    expect((await c.note(note(10).id)).title).toBe("N10");
    expect((await c.readNote("AAAAAAAAAAAAAAAAAAAAAA", note(10).id)).title).toBe("N10");
    expect(server.requests.map((r) => r.path)).toEqual([
      `/api/v1/feeds/inbox/notes/${note(10).id}`,
      `/api/v1/read/AAAAAAAAAAAAAAAAAAAAAA/notes/${note(10).id}`,
    ]);
  });

  test("readNotes() pages by read id and needs no feed", async () => {
    server.route(() => [200, { notes: [note(10)], next: null }]);
    expect(await collect(new Client({ url: server.url }).readNotes("AAAAAAAAAAAAAAAAAAAAAA"))).toHaveLength(1);
    expect(url(server.requests[0]).pathname).toBe("/api/v1/read/AAAAAAAAAAAAAAAAAAAAAA/notes");
  });
});
