import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { IDENTITY_COOKIE, SESSION_COOKIE, login } from "../auth";
import { hasFeed, readIdOf, resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { logsOf } from "../log";
import { cookieValue, feedCookieName, protectedFeed } from "../feedlock";
import { getNote } from "../notes";
import { sign } from "../oauth/tokens";
import { editNote, postNote } from "../posting";
import { dispatch } from "./api";

// POST /<feed> as proxy.ts hands it on: through the dispatcher.
const postNoteRoute = (req: Request, feed: string) => dispatch(req, ["feeds", feed, "notes"]);

const BASE = "http://localhost:3000";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-post-"));
  process.env.DATA_DIR = dir;
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  delete process.env.NOTEFEED_RATE_LIMIT;
  delete process.env.NOTEFEED_MAX_FEEDS;
  delete process.env.NOTEFEED_MAX_NOTES_PER_FEED;
  delete process.env.NOTEFEED_PASSWORD;
  delete process.env.PUBLIC_URL;
  delete process.env.NOTEFEED_TRUST_PROXY;
});

function post(body: BodyInit, headers: Record<string, string> = {}, feed = "test") {
  const h = new Headers({ host: "localhost:3000", ...headers });
  return postNoteRoute(new Request(`${BASE}/${feed}`, { method: "POST", body, headers: h }), feed);
}

const file = (id: string, feed = "test") => readFile(join(dir, feed, `${id}.md`), "utf8");
// The data dir holds only the .secret file (if any) until a note is written.
const written = async () => (await readdir(dir)).filter((f) => f !== ".secret");

test("201 with markdown body; file equals body; response links", async () => {
  const res = await post("# Hi\nthere", { "content-type": "text/markdown" });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.id).toMatch(/^\d{8}T\d{6}Z-[a-z0-9-]+$/);
  expect(body).toEqual({
    id: body.id,
    url: `${BASE}/test/${body.id}`,
    feed_url: `${BASE}/test`,
    read_url: `${BASE}/r/${(await readIdOf("test"))!}/feed.xml`,
  });
  expect(await file(body.id)).toBe("# Hi\nthere");
});

test.each(["application/x-www-form-urlencoded", "text/plain; charset=utf-8"])("accepts %s as raw text", async (type) => {
  const res = await post("# A&b=c\n100% done", { "content-type": type });
  expect(res.status).toBe(201);
  const { id } = await res.json();
  expect(await file(id)).toBe("# A&b=c\n100% done");
});

test("accepts a body without content type", async () => {
  expect((await post(new TextEncoder().encode("# Raw"))).status).toBe(201);
});

test("accepts JSON {markdown}", async () => {
  const res = await post(JSON.stringify({ markdown: "# J" }), { "content-type": "application/json" });
  expect(res.status).toBe(201);
  expect(await file((await res.json()).id)).toBe("# J");
});

test("400 for JSON without a markdown string, or invalid JSON", async () => {
  const noMd = await post(JSON.stringify({ text: "x" }), { "content-type": "application/json" });
  expect(noMd.status).toBe(400);
  expect(await noMd.json()).toEqual({ error: 'JSON needs a "markdown" string', code: "invalid_body" });
  const bad = await post("{not json", { "content-type": "application/json" });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ error: "invalid JSON", code: "invalid_body" });
});

test("415 for other content types", async () => {
  const res = await post("x", { "content-type": "application/pdf" });
  expect(res.status).toBe(415);
  expect(await res.json()).toEqual({ error: "send text/markdown, text/plain, application/json or a form with a markdown field", code: "unsupported_type" });
});

test("400 for an empty body", async () => {
  const res = await post("  \n", { "content-type": "text/plain" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "note is empty", code: "empty_note" });
});

test("size limit is 102400 bytes", async () => {
  expect((await post("a".repeat(102400), { "content-type": "text/plain" })).status).toBe(201);
  const res = await post("a".repeat(102401), { "content-type": "text/plain" });
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "note exceeds 100 KB", code: "too_large" });
});

test("413 from the Content-Length header alone", async () => {
  const res = await post("small", { "content-type": "text/plain", "content-length": "200000" });
  expect(res.status).toBe(413);
});

test("keeps a leading BOM byte-for-byte", async () => {
  const res = await post("﻿# Bom\r\n", { "content-type": "text/plain" });
  expect(await file((await res.json()).id)).toBe("﻿# Bom\r\n");
});

test("400 for a body that is not UTF-8, and nothing written", async () => {
  const latin1 = new Uint8Array([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9]); // "# Café" in Latin-1
  const res = await post(latin1, { "content-type": "text/plain" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "body must be UTF-8", code: "invalid_body" });
  expect(await written()).toEqual([]);
});

test.each(["..", "a/b", decodeURIComponent("%2e%2e"), decodeURIComponent("a%2Fb"), "", "Test", "a.b"])(
  "400 invalid feed name for %j, and nothing written",
  async (feed) => {
    const res = await post("# Hi", { "content-type": "text/plain" }, feed);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid feed name", code: "invalid_feed" });
    expect(await written()).toEqual([]);
  },
);

// proxy.ts forwards every reserved name except logout here.
test.each(["login", "mcp", "api", "health", "r"])("400 feed name is reserved (%s)", async (feed) => {
  const res = await post("# Hi", { "content-type": "text/plain" }, feed);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "feed name is reserved", code: "reserved_feed" });
  expect(await written()).toEqual([]);
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

test("multipart (curl -F markdown=..., the compose box): the markdown field is the note", async () => {
  const res = await post(form({ markdown: "# From a form\r\nbody" }));
  expect(res.status).toBe(201);
  expect(await file((await res.json()).id)).toBe("# From a form\r\nbody");
});

test("an empty password field (the compose box's optional input) means no password", async () => {
  const res = await post(form({ markdown: "# Open", password: "" }));
  expect(res.status).toBe(201);
  expect(await protectedFeed("test")).toBe(false);
});

test("400 for multipart without a markdown field; nothing written", async () => {
  const res = await post(form({ text: "# Hi" }));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'form needs a "markdown" field', code: "invalid_body" });
  expect(await written()).toEqual([]);
});

describe("a browser form post (Accept: text/html) gets a 303 back to the feed page", () => {
  const html = { accept: "text/html,application/xhtml+xml,*/*;q=0.8" };
  test("posted", async () => {
    const res = await post(form({ markdown: "# Hi" }), html);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/test\?posted=\d{8}T\d{6}Z-[0-9a-f-]{36}$/);
  });
  test("refused: the error code, and the wait when rate-limited", async () => {
    expect((await post(form({ markdown: " " }), html)).headers.get("location")).toBe("/test?error=empty_note");
    process.env.NOTEFEED_RATE_LIMIT = "1";
    resetRateLimitsForTests();
    await post(form({ markdown: "a" }), html);
    expect((await post(form({ markdown: "b" }), html)).headers.get("location")).toMatch(/^\/test\?error=rate_limited&retry=\d+$/);
  });
  test("locked without a session: to the login page, coming back to the feed", async () => {
    process.env.NOTEFEED_PASSWORD = "pw";
    const res = await post(form({ markdown: "# Hi" }), html);
    expect(res.headers.get("location")).toBe("/login?next=%2Ftest");
    expect(await written()).toEqual([]);
  });
});

describe("locked: the web UI's session cookie works, from this instance's own pages only", () => {
  const session = () => `${SESSION_COOKIE}=${login("pw", "test")}`;
  beforeEach(() => {
    process.env.NOTEFEED_PASSWORD = "pw";
  });
  test("same origin: 201", async () => {
    expect((await post(form({ markdown: "# Hi" }), { cookie: session(), origin: BASE })).status).toBe(201);
  });
  test("behind a proxy, the origin is checked against the public host", async () => {
    process.env.NOTEFEED_TRUST_PROXY = "1";
    const headers = { cookie: session(), origin: "https://notes.example", "x-forwarded-host": "notes.example", "x-forwarded-proto": "https" };
    expect((await post(form({ markdown: "# Hi" }), headers)).status).toBe(201);
  });
  test.each([
    ["another site", { origin: "https://evil.example" }],
    ["no Origin", {}],
    ["a bad Origin", { origin: "null" }],
  ])("%s: 401, nothing written", async (_, extra) => {
    expect((await post(form({ markdown: "# Hi" }), { cookie: session(), ...extra })).status).toBe(401);
    expect(await written()).toEqual([]);
  });
  test("a wrong cookie: 401", async () => {
    expect((await post(form({ markdown: "# Hi" }), { cookie: `${SESSION_COOKIE}=nope`, origin: BASE })).status).toBe(401);
  });
});

test("locked: 401 without or with a wrong password, and the feed is not created", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  for (const auth of [undefined, "Bearer nope", "pw"]) {
    const res = await post("# Hi", { "content-type": "text/plain", ...(auth ? { authorization: auth } : {}) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "missing or wrong password", code: "auth" });
  }
  expect(await hasFeed("test")).toBe(false);
  expect(await written()).toEqual([]);
});

test("locked: 201 with the right bearer password", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect((await post("# Hi", { "content-type": "text/plain", authorization: "Bearer pw" })).status).toBe(201);
});

test("locked: failed bearers are rate-limited per IP; then even the right one gets 429", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  process.env.NOTEFEED_RATE_LIMIT = "3";
  process.env.NOTEFEED_TRUST_PROXY = "1";
  const from = (ip: string, authorization: string) =>
    post("# Hi", { "content-type": "text/plain", authorization, "x-forwarded-for": ip });
  for (let i = 0; i < 3; i++) expect((await from("1.1.1.1", "Bearer nope")).status).toBe(401);
  for (const auth of ["Bearer nope", "Bearer pw"]) {
    const res = await from("1.1.1.1", auth);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  }
  expect((await from("2.2.2.2", "Bearer pw")).status).toBe(201);
  expect((await readdir(join(dir, "test"))).filter((n) => n.endsWith(".md"))).toHaveLength(1);
});

test("unlocked: any authorization header is ignored", async () => {
  for (const authorization of ["Bearer whatever", "garbage"])
    expect((await post("# Hi", { "content-type": "text/plain", authorization })).status).toBe(201);
});

test("413 for a chunked body over the limit, cancelling the stream early", async () => {
  const chunk = new Uint8Array(16 * 1024).fill(0x61);
  const total = 100; // 1.6 MB if fully read
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulled++ < total) c.enqueue(chunk);
      else c.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const res = await postNoteRoute(
    new Request(`${BASE}/test`, { method: "POST", body, duplex: "half", headers: { "content-type": "text/plain" } } as RequestInit),
    "test",
  );
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "note exceeds 100 KB", code: "too_large" });
  expect(cancelled).toBe(true);
  expect(pulled).toBeLessThan(20);
  expect(await written()).toEqual([]);
});

test("a chunked body at the limit is accepted", async () => {
  const data = new TextEncoder().encode("a".repeat(102400));
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < data.length; i += 4096) c.enqueue(data.slice(i, i + 4096));
      c.close();
    },
  });
  const res = await postNoteRoute(
    new Request(`${BASE}/test`, { method: "POST", body, duplex: "half", headers: { "content-type": "text/plain" } } as RequestInit),
    "test",
  );
  expect(res.status).toBe(201);
  expect(await file((await res.json()).id)).toBe(("a".repeat(102400)));
});

test("61st post in a minute is 429 with numeric Retry-After", async () => {
  for (let i = 0; i < 60; i++) expect((await post(`n${i}`)).status).toBe(201);
  const res = await post("one more");
  expect(res.status).toBe(429);
  expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
});

test("caps below 1 are off", async () => {
  process.env.NOTEFEED_MAX_FEEDS = "-1";
  process.env.NOTEFEED_MAX_NOTES_PER_FEED = "-5";
  expect((await post("a", {}, "one")).status).toBe(201);
  expect((await post("b", {}, "one")).status).toBe(201);
});

test("locked: a 401 doesn't use up a posting slot, only the failed-password budget", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  process.env.NOTEFEED_RATE_LIMIT = "3";
  for (let i = 0; i < 2; i++) expect((await post("# Hi", { authorization: "Bearer nope" })).status).toBe(401);
  for (let i = 0; i < 3; i++) expect((await post(`n${i}`, { authorization: "Bearer pw" })).status).toBe(201);
});

test("NOTEFEED_MAX_FEEDS=1: second new feed 507, first feed still accepts", async () => {
  process.env.NOTEFEED_MAX_FEEDS = "1";
  expect((await post("a", {}, "one")).status).toBe(201);
  let res = new Response();
  expect(await logsOf(async () => (res = await post("b", {}, "two")))).toEqual([{ level: "warn", component: "limits", msg: "cap reached", kind: "feed" }]);
  expect(res.status).toBe(507);
  expect(await res.json()).toEqual({ error: "feed limit reached", code: "feed_limit" });
  expect((await post("c", {}, "one")).status).toBe(201);
});

test("NOTEFEED_MAX_NOTES_PER_FEED=2: third note 507, other feeds unaffected", async () => {
  process.env.NOTEFEED_MAX_NOTES_PER_FEED = "2";
  expect((await post("a", {}, "one")).status).toBe(201);
  expect((await post("b", {}, "one")).status).toBe(201);
  let res = new Response();
  expect(await logsOf(async () => (res = await post("c", {}, "one")))).toEqual([{ level: "warn", component: "limits", msg: "cap reached", kind: "note" }]);
  expect(res.status).toBe(507);
  expect(await res.json()).toEqual({ error: "note limit reached", code: "note_limit" });
  expect((await post("d", {}, "two")).status).toBe(201);
});

describe("feed passwords", () => {
  const text = { "content-type": "text/plain" };
  const pw = { ...text, "x-feed-password": "pw" };
  const notes = async (feed = "test") => (await readdir(join(dir, feed))).filter((f) => f.endsWith(".md"));

  test("X-Feed-Password on a new feed protects it before the first note", async () => {
    expect((await post("# One", pw)).status).toBe(201);
    expect(await readdir(join(dir, "test"))).toContain(".password");
    expect(await notes()).toHaveLength(1);
    for (const h of [text, { ...text, "x-feed-password": "nope" }]) {
      const res = await post("# Two", h);
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("auth");
    }
    expect(await notes()).toHaveLength(1);
    expect((await post("# Three", pw)).status).toBe(201);
    expect(await notes()).toHaveLength(2);
  });

  test("JSON {markdown, password} on a new feed protects it", async () => {
    const res = await post(JSON.stringify({ markdown: "x", password: "pw" }), { "content-type": "application/json" });
    expect(res.status).toBe(201);
    expect((await post("y", text)).status).toBe(401);
    expect((await post("y", pw)).status).toBe(201);
  });

  test("a password for an existing open feed: 409, and the feed stays open", async () => {
    expect((await post("# Open", text)).status).toBe(201);
    const viaHeader = await post("# Claim", pw);
    expect(viaHeader.status).toBe(409);
    expect((await viaHeader.json()).code).toBe("feed_exists");
    const viaBody = await post(JSON.stringify({ markdown: "x", password: "pw" }), { "content-type": "application/json" });
    expect(viaBody.status).toBe(409);
    expect(await readdir(join(dir, "test"))).not.toContain(".password");
    expect((await post("# Still open", text)).status).toBe(201);
  });

  test("a 257-character password on creation: 400, no feed directory", async () => {
    const res = await post("# Hi", { ...text, "x-feed-password": "x".repeat(257) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
    expect(await written()).toEqual([]);
  });

  test("a reserved name or an over-cap creation with a password creates no directory", async () => {
    expect((await post("# Hi", pw, "login")).status).toBe(400);
    expect(await written()).toEqual([]);
    process.env.NOTEFEED_MAX_FEEDS = "1";
    expect((await post("a", text, "one")).status).toBe(201);
    expect((await post("b", pw, "two")).status).toBe(507);
    expect(await written()).toEqual(["one"]);
  });

  test("a blank or oversize first note with a password creates no feed", async () => {
    const json = { "content-type": "application/json" };
    const blank = await post(JSON.stringify({ markdown: "  ", password: "pw" }), json);
    expect(blank.status).toBe(400);
    expect((await blank.json()).code).toBe("empty_note");
    const big = await post(JSON.stringify({ markdown: "x".repeat(102401), password: "pw" }), json);
    expect(big.status).toBe(413);
    expect(await written()).toEqual([]);
  });

  test("a browser form post without the password: back to the feed's unlock screen", async () => {
    await post("# One", pw);
    const res = await post(form({ markdown: "# Hi" }), { accept: "text/html" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/test?error=auth");
  });

  test("the feed cookie works from this instance's own pages only", async () => {
    await post("# One", pw);
    const c = `${feedCookieName("test")}=${await cookieValue("test")}`;
    expect((await post(form({ markdown: "# Hi" }), { cookie: c, origin: BASE })).status).toBe(201);
    expect((await post(form({ markdown: "# Hi" }), { cookie: c })).status).toBe(401);
    // An empty header is no header, so the cookie still applies.
    expect((await post(form({ markdown: "# Hi" }), { cookie: c, origin: BASE, "x-feed-password": "" })).status).toBe(201);
  });

  test("an empty X-Feed-Password or body password is no password", async () => {
    const json = { "content-type": "application/json" };
    expect((await post("# One", { ...text, "x-feed-password": "" })).status).toBe(201);
    expect(await protectedFeed("test")).toBe(false);
    expect((await post("# Two", { ...text, "x-feed-password": "" })).status).toBe(201);
    expect((await post(JSON.stringify({ markdown: "# Three", password: "" }), json)).status).toBe(201);
    expect(await notes()).toHaveLength(3);
  });

  test.each(["pässwort", " lead", "trail ", "tab\tbed", "x".repeat(257)])("a new password that can't travel in a header (%j): 400, no feed", async (password) => {
    const res = await post(JSON.stringify({ markdown: "# Hi", password }), { "content-type": "application/json" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "password must be 1 to 256 printable ASCII characters, with no space at the start or end",
      code: "invalid_body",
    });
    expect(await written()).toEqual([]);
  });

  test("a space inside a password is fine", async () => {
    expect((await post("# One", { ...text, "x-feed-password": "correct horse" })).status).toBe(201);
    expect((await post("# Two", { ...text, "x-feed-password": "correct horse" })).status).toBe(201);
  });

  // The sender decides how long its body takes, so a post admitted before the feed existed can finish after
  // someone created it protected. `reading` resolves once the handler is waiting for the rest of the body.
  const slowPost = (headers: Record<string, string>, first = "# injected ", rest = "by a stranger") => {
    let finish!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const reading = new Promise<void>((r) => (started = r));
    const enc = new TextEncoder();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (pulls++ === 0) return c.enqueue(enc.encode(first));
        started();
        await gate;
        c.enqueue(enc.encode(rest));
        c.close();
      },
    });
    const init = { method: "POST", body, duplex: "half", headers: { host: "localhost:3000", ...headers } } as RequestInit;
    return { response: postNoteRoute(new Request(`${BASE}/test`, init), "test"), reading, finish };
  };

  test("a slow body started before the feed was created protected is refused: no note, no cookie", async () => {
    const stranger = slowPost({ ...text, origin: BASE });
    await stranger.reading;
    expect((await post("# Secret", pw)).status).toBe(201);
    stranger.finish();
    const res = await stranger.response;
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("auth");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await notes()).toHaveLength(1);
  });

  test("a slow body with its own password loses to the feed created meanwhile", async () => {
    const stranger = slowPost({ "content-type": "application/json", origin: BASE }, '{"markdown": "# injected", ', '"password": "theirs"}');
    await stranger.reading;
    expect((await post("# Secret", pw)).status).toBe(201);
    stranger.finish();
    const res = await stranger.response;
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await notes()).toHaveLength(1);
    expect((await post("# Still mine", pw)).status).toBe(201);
  });

  test("only the post that creates a protected feed gets the unlock cookie", async () => {
    await post("# One", pw);
    const again = await post("# Two", { ...pw, origin: BASE });
    expect(again.status).toBe(201);
    expect(again.headers.getSetCookie()).toEqual([]);
  });

  test("posts without a password never use up the failed-attempt budget", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "3";
    await post("# One", pw);
    for (let i = 0; i < 5; i++) expect((await post("# Hi", text)).status).toBe(401);
    expect((await post("# Two", pw)).status).toBe(201);
  });
});

test("a same-origin post that creates a protected feed leaves this browser unlocked", async () => {
  const res = await post(JSON.stringify({ markdown: "# Mine", password: "pw" }), { "content-type": "application/json", origin: BASE }, "mine");
  expect(res.status).toBe(201);
  const v = await cookieValue("mine");
  expect(res.headers.getSetCookie().map((c) => c.split("; ").slice(0, 2).join("; "))).toEqual([
    `${feedCookieName("mine")}=${v}; Path=/mine`,
    `${feedCookieName("mine")}=${v}; Path=/api/v1/feeds/mine`,
  ]);
  const script = await post(JSON.stringify({ markdown: "# Mine", password: "pw2" }), { "content-type": "application/json" }, "mine2");
  expect(script.headers.get("set-cookie")).toBeNull();
});

test("postNote stores a verified sender, and editNote keeps it", async () => {
  const { note } = await postNote("test", "1.1.1.1", async () => ({ markdown: "# Hi" }), {}, "Ann");
  expect((await getNote("test", note.id))!.sender).toBe("Ann");
  const edited = await editNote("test", note.id, "1.1.1.1", async () => ({ markdown: "# Ho" }), {});
  expect(edited.sender).toBe("Ann");
  expect((await getNote("test", note.id))!.sender).toBe("Ann");
});

test("a sender in the request body is ignored", async () => {
  const res = await post(JSON.stringify({ markdown: "x", sender: "Boss" }), { "content-type": "application/json" });
  expect(res.status).toBe(201);
  expect((await getNote("test", (await res.json()).id))!.sender).toBeUndefined();
});

test("a post with the password bearer has no sender", async () => {
  process.env.NOTEFEED_PASSWORD = "secret";
  const res = await post("x", { authorization: "Bearer secret" });
  expect(res.status).toBe(201);
  expect((await getNote("test", (await res.json()).id))!.sender).toBeUndefined();
});

test("identity on: a same-origin post with the identity cookie stores the verified sender, not the body's", async () => {
  for (const [k, v] of Object.entries({ ISSUER: "https://idp.example", CLIENT_ID: "id", CLIENT_SECRET: "s", ALLOW: "*" })) vi.stubEnv(`NOTEFEED_OIDC_${k}`, v);
  const cookie = `${IDENTITY_COOKIE}=${sign("identity", { sender: "Ann" })}`;
  const json = { "content-type": "application/json" };
  expect((await post(JSON.stringify({ markdown: "x" }), { ...json, cookie })).status).toBe(401); // no Origin: not our page
  const res = await post(JSON.stringify({ markdown: "x", sender: "Boss" }), { ...json, cookie, origin: BASE });
  expect(res.status).toBe(201);
  expect((await getNote("test", (await res.json()).id))!.sender).toBe("Ann");
});
afterEach(() => vi.unstubAllEnvs());
