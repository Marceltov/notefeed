import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  AuthError,
  Client,
  ConfigError,
  InvalidNoteError,
  LimitReachedError,
  NotefeedError,
  NoteTooLargeError,
  RateLimitedError,
} from "../src/index.js";
import { fakeServer } from "./server.js";

let server: Awaited<ReturnType<typeof fakeServer>>;
beforeEach(async () => {
  delete process.env.NOTEFEED_URL;
  delete process.env.NOTEFEED_FEED;
  delete process.env.NOTEFEED_PASSWORD;
  server = await fakeServer();
});
afterEach(() => server.close());

const CREATED = {
  id: "20260930T100000Z-cafe",
  url: "https://n.example/inbox/20260930T100000Z-cafe",
  feed_url: "https://n.example/inbox",
  read_url: "https://n.example/r/AAAAAAAAAAAAAAAAAAAAAA/feed.xml",
};

test("postSendsMarkdownAndReturnsNote", async () => {
  server.reply(201, CREATED);
  const note = await new Client({ url: server.url, feed: "inbox" }).post("# Café\r\nx");
  expect(note).toEqual({ id: CREATED.id, url: CREATED.url, readUrl: CREATED.read_url });
  const req = server.requests[0];
  expect(req.method).toBe("POST");
  expect(req.path).toBe("/inbox");
  expect(req.headers.authorization).toBeUndefined();
  expect(req.headers["content-type"]).toBe("text/markdown; charset=utf-8");
  expect(req.body.equals(Buffer.from("# Café\r\nx", "utf8"))).toBe(true);
});

test("returnsReadUrl", async () => {
  server.reply(201, CREATED);
  expect((await new Client({ url: server.url, feed: "inbox" }).post("x")).readUrl).toBe(CREATED.read_url);
});

test("trailingSlashAndSubpath", async () => {
  await new Client({ url: server.url + "/sub/", feed: "inbox" }).post("x");
  expect(server.requests[0].path).toBe("/sub/inbox");
});

test("postUsesClientFeed", async () => {
  await new Client({ url: server.url, feed: "inbox" }).post("x");
  expect(server.requests[0].path).toBe("/inbox");
});

test("postFeedOverridesClientFeed", async () => {
  await new Client({ url: server.url, feed: "inbox" }).post("x", { feed: "other" });
  await new Client({ url: server.url }).post("x", { feed: "other" });
  expect(server.requests.map((r) => r.path)).toEqual(["/other", "/other"]);
});

test("noFeedRaisesConfigErrorBeforeRequest", async () => {
  const err = await new Client({ url: server.url }).post("x").catch((e) => e);
  expect(err).toBeInstanceOf(ConfigError);
  expect(err.message).toMatch(/no feed given/);
  expect(err.status).toBeNull();
  expect(server.requests.length).toBe(0);
});

describe("invalidFeedNameRaisesConfigError", () => {
  test.each(["Inbox", "a/b", "..", "a".repeat(65), "with space"])("%s", async (feed) => {
    expect(() => new Client({ url: server.url, feed })).toThrow(/invalid feed name/);
    const err = await new Client({ url: server.url }).post("x", { feed }).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toMatch(/invalid feed name/);
    expect(server.requests.length).toBe(0);
  });
});

test("invalidFeedNameIsNotEchoed", async () => {
  // The name is the write key: a near miss must not end up in CI logs.
  const feed = "Homelab-7f3k2q9x4m8wz";
  expect(() => new Client({ url: server.url, feed })).toThrow(/invalid feed name/);
  expect(() => new Client({ url: server.url, feed })).not.toThrow(/7f3k2q9x4m8wz/);
  const err = await new Client({ url: server.url }).post("x", { feed }).catch((e) => e);
  expect(err.message).not.toContain("7f3k2q9x4m8wz");
});

test("passwordSentAsBearerOnlyWhenSet", async () => {
  await new Client({ url: server.url, feed: "inbox" }).post("x");
  await new Client({ url: server.url, feed: "inbox", password: "" }).post("x");
  await new Client({ url: server.url, feed: "inbox", password: "s3cret\n" }).post("x");
  expect(server.requests.map((r) => r.headers.authorization)).toEqual([undefined, undefined, "Bearer s3cret"]);
});

test("ignoresEnvironment", async () => {
  // The library takes its settings from code only; env vars are the CLI's business.
  process.env.NOTEFEED_URL = "http://127.0.0.1:1";
  process.env.NOTEFEED_FEED = "envfeed";
  process.env.NOTEFEED_PASSWORD = "envpw";
  await new Client({ url: server.url, feed: "argfeed" }).post("x");
  expect(server.requests[0].path).toBe("/argfeed");
  expect(server.requests[0].headers.authorization).toBeUndefined();
  expect(() => new Client({ url: "" })).toThrow(ConfigError);
});

test("missingUrl", () => {
  expect(() => new Client({ url: "", feed: "inbox" })).toThrow(/url/);
  // Plain-JS callers get a ConfigError, not a TypeError from reading undefined.
  expect(() => new (Client as unknown as new () => Client)()).toThrow(ConfigError);
});

test("noModuleLevelPost", async () => {
  expect("post" in (await import("../src/index.js"))).toBe(false);
});

describe("errorMapping", () => {
  test.each([
    [400, InvalidNoteError],
    [415, InvalidNoteError],
    [401, AuthError],
    [413, NoteTooLargeError],
    [429, RateLimitedError],
    [507, LimitReachedError],
    [500, NotefeedError],
  ])("%i", async (status, type) => {
    server.reply(status, { error: `reason ${status}` });
    const err = await new Client({ url: server.url, feed: "inbox" }).post("x").catch((e) => e);
    expect(err.constructor).toBe(type);
    expect(err).toBeInstanceOf(NotefeedError);
    expect(err.status).toBe(status);
    expect(err.message).toBe(`reason ${status}`);
  });
});

test("429RaisesRateLimitedWithRetryAfter", async () => {
  server.reply(429, { error: "rate limit exceeded" }, "application/json", { "Retry-After": "42" });
  server.reply(429, { error: "rate limit exceeded" });
  const c = new Client({ url: server.url, feed: "inbox" });
  const first = await c.post("x").catch((e) => e);
  expect(first).toBeInstanceOf(RateLimitedError);
  expect(first.retryAfter).toBe(42);
  const second = await c.post("x").catch((e) => e);
  expect(second).toBeInstanceOf(RateLimitedError);
  expect(second.retryAfter).toBeNull();
});

test("507RaisesLimitReached", async () => {
  server.reply(507, { error: "note limit reached" });
  const err = await new Client({ url: server.url, feed: "inbox" }).post("x").catch((e) => e);
  expect(err).toBeInstanceOf(LimitReachedError);
  expect(err.message).toBe("note limit reached");
  expect(err.status).toBe(507);
});

test("nonJsonErrorBody", async () => {
  server.reply(502, "<html>bad gateway</html>", "text/html");
  const err = await new Client({ url: server.url, feed: "inbox" }).post("x").catch((e) => e);
  expect(err.constructor).toBe(NotefeedError);
  expect(err.status).toBe(502);
  expect(err.message).toContain("502");
});

test("connectionRefused", async () => {
  const err = await new Client({ url: "http://127.0.0.1:1", feed: "inbox" }).post("x").catch((e) => e);
  expect(err).toBeInstanceOf(NotefeedError);
  expect(err.status).toBeNull();
});

test("nonJsonSuccessBody", async () => {
  server.reply(200, "<html>some other site</html>", "text/html");
  const err = await new Client({ url: server.url, feed: "inbox" }).post("x").catch((e) => e);
  expect(err.constructor).toBe(NotefeedError);
  expect(err.status).toBe(200);
  expect(err.message).toContain("not a notefeed");
});

test("passwordControlCharsRejectedWithoutEcho", () => {
  let err: unknown;
  try {
    new Client({ url: "http://x", feed: "inbox", password: "sec\nret" });
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ConfigError);
  expect((err as Error).message).toContain("invalid characters");
  expect((err as Error).message).not.toMatch(/sec|ret/);
});

test("nonHttpReply", async () => {
  const { createServer } = await import("node:net");
  const srv = createServer((s) => s.once("data", () => s.end("SSH-2.0-OpenSSH_9.6\r\n")));
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  const err = await new Client({ url: `http://127.0.0.1:${port}`, feed: "inbox" }).post("x").catch((e) => e);
  expect(err).toBeInstanceOf(NotefeedError);
  expect(err.status).toBeNull();
  srv.close();
});

test("htmlErrorBodyCollapsed", async () => {
  server.reply(502, "<html>\n  <body>bad gateway</body>\n</html>\n", "text/html");
  const err = await new Client({ url: server.url, feed: "inbox" }).post("x").catch((e) => e);
  expect(err.message).toBe("HTTP 502: <html> <body>bad gateway</body> </html>");
});
