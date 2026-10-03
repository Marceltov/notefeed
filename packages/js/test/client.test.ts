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
  file: "20260930T100000Z-cafe.md",
  file_url: "https://n.example/r/AAAAAAAAAAAAAAAAAAAAAA/20260930T100000Z-cafe.md",
};
const note = (h: number): Note => ({
  id: `20260930T${String(h).padStart(2, "0")}0000Z-n${h}`,
  type: "text/markdown",
  file: `20260930T${String(h).padStart(2, "0")}0000Z-n${h}.md`,
  file_url: `https://n.example/r/X/20260930T${String(h).padStart(2, "0")}0000Z-n${h}.md`,
  size: 4,
  title: `N${h}`,
  content: `# N${h}`,
  tags: [],
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
  test("a string is markdown: the body is the text, Content-Type text/markdown, and the answer is the created note", async () => {
    server.reply(201, CREATED);
    expect(await new Client({ url: server.url, feed: "inbox" }).post("# Café\r\nx")).toEqual(CREATED);
    const req = server.requests[0];
    expect([req.method, req.path]).toEqual(["POST", "/api/v1/feeds/inbox/notes"]);
    expect(req.body.toString()).toBe("# Café\r\nx");
    expect(req.headers["content-type"]).toBe("text/markdown");
    expect(req.headers.authorization).toBeUndefined();
  });
  test("bytes and Blobs are a file of the given type; without a type it is a ConfigError", async () => {
    server.reply(201, CREATED);
    const c = new Client({ url: server.url, feed: "inbox" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255]);
    await c.post(png, { type: "image/png" });
    await c.post(new Blob([png], { type: "image/png" }));
    for (const r of server.requests) {
      expect(r.headers["content-type"]).toBe("image/png");
      expect([...r.body]).toEqual([...png]);
    }
    await expect(c.post(png)).rejects.toBeInstanceOf(ConfigError);
    await expect(c.post(new Blob([png]))).rejects.toBeInstanceOf(ConfigError);
  });
  test("a feed without a read link: read_url is null", async () => {
    server.reply(201, { ...CREATED, read_url: null });
    expect((await new Client({ url: server.url, feed: "inbox" }).post("# Hi")).read_url).toBeNull();
  });
  test("the password goes as a bearer; a per-call feed overrides the default", async () => {
    await new Client({ url: server.url, feed: "inbox", password: "pw" }).post("x", { feed: "other" });
    expect(server.requests[0].path).toBe("/api/v1/feeds/other/notes");
    expect(server.requests[0].headers.authorization).toBe("Bearer pw");
  });
  test("title, tags, alt, name and read id go as headers, and nothing is sent for what is left out", async () => {
    server.reply(201, CREATED);
    const c = new Client({ url: server.url, feed: "inbox" });
    await c.post("x", { title: "T", tags: ["ci", "deploy"], readId: "my-feed" });
    await c.post("x", { tags: [] });
    expect(server.requests[0].headers).toMatchObject({ "x-note-title": "T", "x-note-tags": "ci,deploy", "x-read-id": "my-feed" });
    for (const h of ["x-note-title", "x-note-tags", "x-note-alt", "x-note-name", "x-read-id"]) expect(server.requests[1].headers[h]).toBeUndefined();
  });
  test("a title, alt text or name that is not ASCII goes as its UTF-8 bytes, which fetch can send", async () => {
    server.reply(201, CREATED);
    await new Client({ url: server.url, feed: "inbox" }).post(new Blob([new Uint8Array([1])], { type: "image/png" }), { title: "Café 日本語", alt: "Größe", name: "Größe.png" });
    const h = server.requests[0].headers;
    const utf8 = (v: string | string[] | undefined) => Buffer.from(String(v), "latin1").toString("utf8"); // how a server reads the header bytes
    expect([utf8(h["x-note-title"]), utf8(h["x-note-alt"]), utf8(h["x-note-name"])]).toEqual(["Café 日本語", "Größe", "Größe.png"]);
  });
  test("notes({ tag }) goes as ?tag=", async () => {
    const c = new Client({ url: server.url, feed: "inbox" });
    server.reply(200, { notes: [], next: null });
    for await (const _ of c.notes({ tag: "ci" })) void _;
    expect(new URL(server.requests[0].path, "http://x").searchParams.get("tag")).toBe("ci");
  });
  test("feedPassword goes as X-Feed-Password on post, notes and note; a per-call one wins; none sends no header", async () => {
    server.route((r) => (r.path.includes("/notes/") ? [200, note(10)] : r.method === "GET" ? [200, { notes: [], next: null }] : [201, CREATED]));
    const c = new Client({ url: server.url, feed: "inbox", feedPassword: "fp" });
    await c.post("x");
    for await (const _ of c.notes()); // eslint-disable-line no-empty
    await c.note("20260930T100000Z-n10");
    await c.post("x", { feedPassword: "other" });
    await new Client({ url: server.url, feed: "inbox" }).post("x");
    const h = server.requests.map((r) => r.headers["x-feed-password"]);
    expect(h).toEqual(["fp", "fp", "fp", "other", undefined]);
    expect(server.requests[0].headers.authorization).toBeUndefined();
  });
  test("a feed password with a control character is a ConfigError", () => {
    expect(() => new Client({ url: server.url, feedPassword: "p\nw" })).toThrow(ConfigError);
  });
  test("a base URL with a path prefix and a trailing slash keeps the prefix", async () => {
    await new Client({ url: `${server.url}/prefix/`, feed: "inbox" }).post("x");
    expect(server.requests[0].path).toBe("/prefix/api/v1/feeds/inbox/notes");
  });
});

describe("edit and delete", () => {
  const ID = "20260930T100000Z-n10";
  test("edit PUTs the new content, as the note's type, and returns the note; feed and feedPassword work as for post", async () => {
    server.reply(200, note(10));
    const c = new Client({ url: server.url, feed: "inbox", password: "pw", feedPassword: "fp" });
    expect(await c.edit(ID, "# New\r\nx")).toEqual(note(10));
    const req = server.requests[0];
    expect([req.method, req.path]).toEqual(["PUT", `/api/v1/feeds/inbox/notes/${ID}`]);
    expect(req.body.toString()).toBe("# New\r\nx");
    expect(req.headers["content-type"]).toBe("text/markdown");
    expect(req.headers.authorization).toBe("Bearer pw");
    expect(req.headers["x-feed-password"]).toBe("fp");
    server.reply(200, note(10));
    await c.edit(ID, new Uint8Array([1, 2]), { type: "image/png", feed: "other", feedPassword: "o" });
    expect(server.requests[1].path).toBe(`/api/v1/feeds/other/notes/${ID}`);
    expect(server.requests[1].headers["content-type"]).toBe("image/png");
    expect(server.requests[1].headers["x-feed-password"]).toBe("o");
  });
  test("update PATCHes the title and alt text as JSON", async () => {
    server.reply(200, note(10));
    const c = new Client({ url: server.url, feed: "inbox", password: "pw" });
    expect(await c.update(ID, { title: "T", alt: "" })).toEqual(note(10));
    const req = server.requests[0];
    expect([req.method, req.path]).toEqual(["PATCH", `/api/v1/feeds/inbox/notes/${ID}`]);
    expect(JSON.parse(req.body.toString())).toEqual({ title: "T", alt: "" });
    expect(req.headers.authorization).toBe("Bearer pw");
  });
  test("delete sends DELETE and resolves to nothing on 204", async () => {
    server.reply(204, "", "text/plain");
    const c = new Client({ url: server.url, feed: "inbox", feedPassword: "fp" });
    expect(await c.delete(ID)).toBeUndefined();
    const req = server.requests[0];
    expect([req.method, req.path]).toEqual(["DELETE", `/api/v1/feeds/inbox/notes/${ID}`]);
    expect(req.headers["x-feed-password"]).toBe("fp");
    expect(req.body.length).toBe(0);
  });
  test("a 404 is a NotFoundError for both; no feed is a ConfigError", async () => {
    const c = new Client({ url: server.url, feed: "inbox" });
    server.reply(404, { error: "no such note", code: "not_found" });
    await expect(c.edit(ID, "x")).rejects.toBeInstanceOf(NotFoundError);
    server.reply(404, { error: "no such note", code: "not_found" });
    await expect(c.delete(ID)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new Client({ url: server.url }).delete(ID)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("feed settings and deletion", () => {
  const FEED = { name: "inbox", title: "My inbox", description: "Things", protected: false, read_url: null };
  test("feedInfo GETs the feed and returns it; feed and feedPassword work as for post", async () => {
    server.reply(200, FEED);
    const c = new Client({ url: server.url, feed: "inbox", password: "pw", feedPassword: "fp" });
    expect(await c.feedInfo()).toEqual(FEED);
    const req = server.requests[0];
    expect([req.method, req.path]).toEqual(["GET", "/api/v1/feeds/inbox"]);
    expect(req.headers.authorization).toBe("Bearer pw");
    expect(req.headers["x-feed-password"]).toBe("fp");
    server.reply(200, FEED);
    await c.feedInfo({ feed: "other", feedPassword: "o" });
    expect(server.requests[1].path).toBe("/api/v1/feeds/other");
    expect(server.requests[1].headers["x-feed-password"]).toBe("o");
  });
  test("updateFeed PUTs {title, description} and returns the feed", async () => {
    server.reply(200, FEED);
    const c = new Client({ url: server.url, feed: "inbox", feedPassword: "fp" });
    expect(await c.updateFeed({ title: "My inbox", description: "Things" })).toEqual(FEED);
    const req = server.requests[0];
    expect([req.method, req.path]).toEqual(["PUT", "/api/v1/feeds/inbox"]);
    expect(JSON.parse(req.body.toString())).toEqual({ title: "My inbox", description: "Things" });
    expect(req.headers["x-feed-password"]).toBe("fp");
    server.reply(200, FEED);
    await c.updateFeed({ title: "", description: "" }, { feed: "other", feedPassword: "o" });
    expect(server.requests[1].path).toBe("/api/v1/feeds/other");
    expect(server.requests[1].headers["x-feed-password"]).toBe("o");
  });
  test("deleteFeed sends DELETE and resolves to nothing on 204", async () => {
    server.reply(204, "", "text/plain");
    const c = new Client({ url: server.url, feed: "inbox", feedPassword: "fp" });
    expect(await c.deleteFeed()).toBeUndefined();
    const req = server.requests[0];
    expect([req.method, req.path]).toEqual(["DELETE", "/api/v1/feeds/inbox"]);
    expect(req.headers["x-feed-password"]).toBe("fp");
    expect(req.body.length).toBe(0);
  });
  test("a 404 is a NotFoundError for all three; no feed is a ConfigError", async () => {
    const c = new Client({ url: server.url, feed: "inbox" });
    const calls = [() => c.feedInfo(), () => c.updateFeed({ title: "", description: "" }), () => c.deleteFeed()];
    for (const call of calls) {
      server.reply(404, { error: "no such feed", code: "not_found" });
      await expect(call()).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(new Client({ url: server.url }).deleteFeed()).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("pictures", () => {
  const UPLOADED = { ...CREATED, id: "20261003T101010Z-u", file: "20261003T101010Z-u.png", file_url: "https://n.example/r/X/20261003T101010Z-u.png" };
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255]);
  test("a picture is posted like any note, with its type; the answer names its file", async () => {
    server.reply(201, UPLOADED);
    const c = new Client({ url: server.url, feed: "inbox", password: "pw", feedPassword: "fp" });
    expect((await c.post(bytes, { type: "image/png", alt: "a cat" })).file).toBe(UPLOADED.file);
    const req = server.requests[0];
    expect([req.method, req.path]).toEqual(["POST", "/api/v1/feeds/inbox/notes"]);
    expect(req.headers["content-type"]).toBe("image/png");
    expect(req.headers["x-note-alt"]).toBe("a cat");
    expect([...req.body]).toEqual([...bytes]);
    expect(req.headers.authorization).toBe("Bearer pw");
    expect(req.headers["x-feed-password"]).toBe("fp");
  });
  test("no feed is a ConfigError; 415, 413, 507 and 404 map to the usual classes", async () => {
    await expect(new Client({ url: server.url }).post(bytes, { type: "image/png" })).rejects.toBeInstanceOf(ConfigError);
    for (const [status, code, cls] of [
      [415, "unsupported_type", InvalidRequestError],
      [413, "too_large", NoteTooLargeError],
      [507, "image_limit", LimitReachedError],
      [404, "not_found", NotFoundError],
    ] as const) {
      server.reply(status, { error: code, code });
      await expect(new Client({ url: server.url, feed: "inbox" }).post(bytes, { type: "image/png" })).rejects.toBeInstanceOf(cls);
    }
  });
  test("updateFeed sends image when given (an empty string clears it) and leaves it out otherwise", async () => {
    server.reply(200, {});
    const c = new Client({ url: server.url, feed: "inbox" });
    await c.updateFeed({ title: "t", description: "d", image: "a.png" });
    await c.updateFeed({ title: "t", description: "d", image: "" });
    await c.updateFeed({ title: "t", description: "d" });
    const bodies = server.requests.map((r) => JSON.parse(r.body.toString()));
    expect(bodies).toEqual([{ title: "t", description: "d", image: "a.png" }, { title: "t", description: "d", image: "" }, { title: "t", description: "d" }]);
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
    ["image_limit", 507, LimitReachedError],
    ["too_large", 413, NoteTooLargeError],
    ["invalid_feed", 400, InvalidRequestError],
    ["reserved_feed", 400, InvalidRequestError],
    ["empty_note", 400, InvalidRequestError],
    ["invalid_body", 400, InvalidRequestError],
    ["invalid_request", 400, InvalidRequestError],
    ["unsupported_type", 415, InvalidRequestError],
    ["feed_exists", 409, InvalidRequestError],
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
  test("fromEnv reads NOTEFEED_URL, NOTEFEED_FEED, NOTEFEED_PASSWORD and NOTEFEED_FEED_PASSWORD", async () => {
    const c = Client.fromEnv({ NOTEFEED_URL: server.url, NOTEFEED_FEED: "inbox", NOTEFEED_PASSWORD: "pw", NOTEFEED_FEED_PASSWORD: "fp" });
    await c.post("x");
    expect(server.requests[0].headers["x-feed-password"]).toBe("fp");
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
