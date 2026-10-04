import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { hasFeed, readIdOf, resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";
import { logTo } from "./log";
import { createNote, getNote, listNotes } from "./notes";
import { storage } from "./storage";
import { mcpRoute } from "./mcp";
import { sign } from "./oauth/tokens";

// Log lines, captured per test.
let logs: string[] = [];
let restoreLog = () => {};
beforeEach(() => {
  logs = [];
  restoreLog = logTo((l) => void logs.push(l));
});
afterEach(() => restoreLog());

const V = "2026-07-28";
const META = { "io.modelcontextprotocol/clientInfo": { name: "t", version: "0" }, "io.modelcontextprotocol/clientCapabilities": {} };
let dir: string;
beforeEach(async () => {
  dir = process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-mcp-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
  resetRateLimitsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL"]) delete process.env[k];
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}, version = V, withMeta = true) {
  const name: Record<string, string> = typeof params.name === "string" ? { "mcp-name": params.name } : {};
  const _meta = { "io.modelcontextprotocol/protocolVersion": version, ...META };
  return mcpRoute(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": version, "mcp-method": method, ...name, ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: withMeta ? { ...params, _meta } : params }),
    }),
  );
}
const call = async (tool: string, args: Record<string, unknown>) => (await (await rpc("tools/call", { name: tool, arguments: args })).json()).result;

describe("protocol", () => {
  test("tools/list", async () => {
    const tools = (await (await rpc("tools/list")).json()).result.tools;
    expect(tools.map((t: { name: string }) => t.name).sort()).toEqual(["delete_feed", "delete_note", "edit_note", "get_feed", "get_note", "list_notes", "post_file", "post_note", "update_feed"]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint === true).toBe(["get_feed", "get_note", "list_notes"].includes(t.name));
      expect(t.annotations?.destructiveHint === true).toBe(["edit_note", "delete_note", "update_feed", "delete_feed"].includes(t.name));
      expect(t.annotations?.idempotentHint === true).toBe(["edit_note", "update_feed"].includes(t.name));
    }
  });
  test("server/discover lists the version", async () => {
    const res = await rpc("server/discover");
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain(V);
  });
  test("initialize is refused, naming the version", async () => {
    const res = await rpc("initialize", { protocolVersion: "2025-11-25" }, { "mcp-protocol-version": "", "mcp-method": "" }, V, false);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(V);
  });
  test("unknown version", async () => {
    const res = await rpc("tools/list", {}, {}, "2099-01-01");
    expect(res.status).toBe(400);
    expect((await res.json()).error.data.supported).toContain(V);
  });
  test("mcp-method header must match the body", async () => {
    const res = await rpc("tools/list", {}, { "mcp-method": "tools/call" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32020);
  });
  test("a foreign Origin is 403, the own one passes", async () => {
    expect((await rpc("tools/list", {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await rpc("tools/list", {}, { origin: "http://localhost:3000" })).status).toBe(200);
  });
});

describe("tools", () => {
  test("a tool call answers with a single JSON body", async () => {
    const res = await rpc("tools/call", { name: "list_notes", arguments: { feed: "a" } });
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("post_note", async () => {
    const r = await call("post_note", { feed: "a", markdown: "# Hi" });
    const { id } = r.structuredContent;
    expect(r.structuredContent).toEqual({
      id,
      url: `http://localhost:3000/a/${id}`,
      feed_url: "http://localhost:3000/a",
      read_url: `http://localhost:3000/r/${(await readIdOf("a"))!}/feed.xml`,
      attachments: [],
    });
    expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent);
  });

  test("a refused input value is not echoed by an MCP error", async () => {
    const bad = "a\u202eb\u009b[31m";
    const results = [
      await call("post_note", { feed: bad, markdown: "x" }),
      await call("post_note", { feed: "a", markdown: "x", attachments: [{ name: bad, type: "image/png", data: "AA" }] }),
      await call("post_note", { feed: "a", markdown: "x", tags: [bad] }),
      await call("post_note", { feed: "a", markdown: 5, [bad]: 1 }),
    ];
    for (const r of results) {
      expect(r.isError).toBe(true);
      expect(r.content[0].text).not.toMatch(/[\u0080-\u009f\u202a-\u202e]/);
    }
  });

  test("post_note ignores a sender argument and stores none", async () => {
    const r = await call("post_note", { feed: "a", markdown: "# Hi", sender: "Boss" });
    expect(r.isError).toBeUndefined();
    expect((await getNote("a", r.structuredContent.id))!.sender).toBeUndefined();
  });

  test("post_note takes tags, list_notes shows and filters by them", async () => {
    const r = await call("post_note", { feed: "a", markdown: "# Tagged", tags: ["CI", "env:prod"] });
    expect(r.isError).toBeUndefined();
    await call("post_note", { feed: "a", markdown: "# Untagged" });
    const listed = (await call("list_notes", { feed: "a", tag: "ci" })).structuredContent.notes;
    expect(listed.map((n: { id: string; tags: string[] }) => [n.id, n.tags])).toEqual([[r.structuredContent.id, ["ci", "env:prod"]]]);
    expect((await call("post_note", { feed: "a", markdown: "# x", tags: ["no good"] })).isError).toBe(true);
    for (const title of ["a\u009bb", "a\u202eb", "a\u2028b"]) expect((await call("post_note", { feed: "a", markdown: "# x", title })).isError, JSON.stringify(title)).toBe(true);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString("base64");
    for (const alt of ["a\u009bb", "a\u202eb", "a\u2028b"]) expect((await call("post_file", { feed: "a", type: "image/png", data: png, alt })).isError, JSON.stringify(alt)).toBe(true);
  });

  test("post_note to a feed without a read link answers read_url null", async () => {
    await mkdir(join(dir, "nolink", ".readid"), { recursive: true }); // can't be read
    const r = await call("post_note", { feed: "nolink", markdown: "# Hi" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.read_url).toBeNull();
  });

  test("list_notes pages newest first without the content", async () => {
    const ids: string[] = [];
    for (const [i, m] of ["# One", "# Two", "# Three"].entries()) ids.push((await createNote("a", m, new Date(Date.UTC(2026, 8, 29, 10 + i)))).note.id);
    const first = (await call("list_notes", { feed: "a", limit: 2 })).structuredContent;
    expect(first.notes).toHaveLength(2);
    expect(first.notes[0].id).toBe(ids[2]);
    for (const n of first.notes) expect(Object.keys(n).sort()).toEqual(["created_at", "id", "tags", "title", "type", "url"]);
    expect(first.next).toBe(first.notes[1].id);
    const rest = (await call("list_notes", { feed: "a", limit: 2, before: first.next })).structuredContent;
    expect(rest.notes).toHaveLength(1);
    expect(rest.next).toBeNull();
  });

  test("list_notes and get_note include the sender when there is one", async () => {
    const { note } = await createNote("a", "# Hi", undefined, "Ann");
    await createNote("a", "# No", new Date(Date.now() - 5000));
    const l = (await call("list_notes", { feed: "a" })).structuredContent.notes;
    expect(l[0].sender).toBe("Ann");
    expect(l[1]).not.toHaveProperty("sender");
    expect((await call("get_note", { feed: "a", id: note.id })).structuredContent.sender).toBe("Ann");
  });

  test("get_note", async () => {
    const { id } = (await call("post_note", { feed: "a", markdown: "# Hi\nbody" })).structuredContent;
    const n = (await call("get_note", { feed: "a", id })).structuredContent;
    expect(n).toEqual({ id, type: "text/markdown", title: "Hi", content: "# Hi\nbody", created_at: expect.any(String), url: `http://localhost:3000/a/${id}`, tags: [] });
    const miss = await call("get_note", { feed: "a", id: "20260101T000000Z-nope" });
    expect(miss.isError).toBe(true);
    expect(miss.content[0].text).toBe("no such note");
  });

  test("a protected feed: created with password, read only with it", async () => {
    const made = await call("post_note", { feed: "p", markdown: "# Hi", password: "pw" });
    const { id } = made.structuredContent;
    for (const [tool, args] of [["list_notes", { feed: "p" }], ["get_note", { feed: "p", id }], ["post_note", { feed: "p", markdown: "x" }]] as const) {
      const r = await call(tool, args);
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toBe("missing or wrong password");
      expect((await call(tool, { ...args, password: "bad" })).isError).toBe(true);
    }
    expect((await call("list_notes", { feed: "p", password: "pw" })).structuredContent.notes).toHaveLength(1);
    expect((await call("get_note", { feed: "p", id, password: "pw" })).structuredContent.id).toBe(id);
    expect((await call("post_note", { feed: "p", markdown: "y", password: "pw" })).isError).toBeUndefined();
  });

  test("calls without a password are refused but never counted as failed attempts", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "2";
    await call("post_note", { feed: "p", markdown: "# Hi", password: "pw" });
    for (const password of [undefined, ""]) {
      for (let i = 0; i < 3; i++) expect((await call("list_notes", { feed: "p", password })).content[0].text).toBe("missing or wrong password");
    }
    expect((await call("list_notes", { feed: "p", password: "pw" })).structuredContent.notes).toHaveLength(1);
    for (let i = 0; i < 2; i++) expect((await call("list_notes", { feed: "p", password: "bad" })).isError).toBe(true);
    expect((await call("list_notes", { feed: "p", password: "pw" })).content[0].text).toMatch(/too many/i);
  });

  test("an empty password is no password", async () => {
    await call("post_note", { feed: "o", markdown: "x" });
    expect((await call("post_note", { feed: "o", markdown: "y", password: "" })).isError).toBeUndefined();
    expect((await call("post_note", { feed: "fresh", markdown: "x", password: "" })).isError).toBeUndefined();
    expect((await call("list_notes", { feed: "fresh" })).structuredContent.notes).toHaveLength(1);
  });

  test("a password never claims an existing open feed", async () => {
    await call("post_note", { feed: "o", markdown: "x" });
    const r = await call("post_note", { feed: "o", markdown: "y", password: "pw" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("feed already exists and has no password");
    expect((await call("list_notes", { feed: "o" })).structuredContent.notes).toHaveLength(1);
  });

  test("a reserved name on a read tool is refused before any lookup", async () => {
    const r = await call("list_notes", { feed: "login", password: "x" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("feed name is reserved");
  });

  test("feeds are isolated", async () => {
    const { id } = (await call("post_note", { feed: "a", markdown: "x" })).structuredContent;
    expect((await call("list_notes", { feed: "b" })).structuredContent.notes).toEqual([]);
    expect((await call("get_note", { feed: "b", id })).isError).toBe(true);
  });

  test("reserved and invalid feed names", async () => {
    const r = await call("post_note", { feed: "login", markdown: "x" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("feed name is reserved");
    const res = await (await rpc("tools/call", { name: "post_note", arguments: { feed: "Backups ", markdown: "x" } })).json();
    expect(res.result.isError).toBe(true);
    const names = await readdir(dir);
    expect(names.filter((n) => n.toLowerCase().startsWith("backups"))).toEqual([]);
  });

  test("an unexpected failure is logged, not shown", async () => {
    await writeFile(join(dir, "file"), "");
    process.env.DATA_DIR = join(dir, "file"); // a file where the data directory should be
    resetFeedsForTests();
    const r = await call("post_note", { feed: "a", markdown: "x" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("internal error");
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toMatchObject({ level: "error", component: "mcp", msg: "tool failed", err: { type: "Error" } });
  });

  test("a failing note file is logged without the feed's name or the note's title", async () => {
    const { note } = await createNote("myfeed", "# Quarterly layoffs plan");
    const file = join(dir, "myfeed", `${note.id}.md`);
    // A read that fails with the path in the error (a linked note is "not a note" now, so the failure is injected).
    vi.spyOn(storage(), "readNote").mockRejectedValueOnce(Object.assign(new Error(`ELOOP: too many symbolic links encountered, open '${file}'`), { code: "ELOOP" }));
    const r = await call("get_note", { feed: "myfeed", id: note.id });
    expect(r.content[0].text).toBe("internal error");
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toMatchObject({ level: "error", component: "mcp", msg: "tool failed", err: { code: "ELOOP", message: expect.stringContaining(`${dir}/<path>`) } });
    expect(logs[0]).not.toMatch(/myfeed|quarterly-layoffs-plan|Quarterly/);
  });

  test("empty note and rate limit", async () => {
    const e = await call("post_note", { feed: "a", markdown: "  " });
    expect(e.isError).toBe(true);
    expect(e.content[0].text).toBe("note is empty");
    process.env.NOTEFEED_RATE_LIMIT = "1";
    resetRateLimitsForTests();
    expect((await call("post_note", { feed: "a", markdown: "x" })).isError).toBeUndefined();
    const r = await call("post_note", { feed: "a", markdown: "y" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("rate limit exceeded");
  });
});

describe("gate on a locked instance", () => {
  const META_URL = 'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"';
  const WWW = `Bearer ${META_URL}`;
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  beforeEach(() => {
    process.env.NOTEFEED_PASSWORD = "pw";
  });

  test("no authorization is 401 pointing at the metadata", async () => {
    const res = await rpc("tools/list");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(WWW);
  });
  test("the password works as a bearer", async () => {
    expect((await rpc("tools/list", {}, bearer("pw"))).status).toBe(200);
  });
  test("an access token for this resource works", async () => {
    expect((await rpc("tools/list", {}, bearer(sign("access", { aud: "http://localhost:3000/mcp" })))).status).toBe(200);
  });
  test("an access token for another resource, or a refresh token, is 401", async () => {
    expect((await rpc("tools/list", {}, bearer(sign("access", { aud: "http://other/mcp" })))).status).toBe(401);
    expect((await rpc("tools/list", {}, bearer(sign("refresh", { cid: "c", aud: "http://localhost:3000/mcp", jti: "j" })))).status).toBe(401);
  });
  test.each([
    ["expired", () => sign("access", { aud: "http://localhost:3000/mcp" }, Date.now() - 3601_000)],
    ["for another resource", () => sign("access", { aud: "http://other/mcp" })],
  ])("an access token %s is invalid_token and no failed password attempt", async (_, token) => {
    process.env.NOTEFEED_RATE_LIMIT = "1";
    const res = await rpc("tools/list", {}, bearer(token()));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(`Bearer error="invalid_token", ${META_URL}`);
    expect((await rpc("tools/list", {}, bearer("pw"))).status).toBe(200);
  });
  test("the scheme is case-insensitive and extra spaces are fine", async () => {
    expect((await rpc("tools/list", {}, { authorization: "bearer pw" })).status).toBe(200);
    expect((await rpc("tools/list", {}, { authorization: "Bearer  pw" })).status).toBe(200);
  });
  test("over the failed-attempt limit is 429, even with the right password", async () => {
    process.env.NOTEFEED_RATE_LIMIT = "2";
    expect((await rpc("tools/list", {}, bearer("a"))).status).toBe(401);
    expect((await rpc("tools/list", {}, bearer("b"))).status).toBe(401);
    const res = await rpc("tools/list", {}, bearer("pw"));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
  test("identity only (no password): an access token works and carries its sender into post_note; an empty bearer never does", async () => {
    delete process.env.NOTEFEED_PASSWORD;
    for (const [k, v] of Object.entries({ ISSUER: "https://idp.example", CLIENT_ID: "id", CLIENT_SECRET: "s", ALLOW: "*" })) vi.stubEnv(`NOTEFEED_OIDC_${k}`, v);
    for (const h of [{}, { authorization: "Bearer " }, { authorization: "Bearer" }, bearer("x")]) expect((await rpc("tools/list", {}, h)).status).toBe(401);
    const t = sign("access", { aud: "http://localhost:3000/mcp", sender: "Ann" });
    const res = await rpc("tools/call", { name: "post_note", arguments: { feed: "a", markdown: "# Hi", sender: "Boss" } }, bearer(t));
    expect(res.status).toBe(200);
    const id = (await res.json()).result.structuredContent.id;
    expect((await getNote("a", id))!.sender).toBe("Ann");
  });
  test("a post_note with the password bearer has no sender", async () => {
    const res = await rpc("tools/call", { name: "post_note", arguments: { feed: "a", markdown: "# Hi" } }, bearer("pw"));
    expect((await getNote("a", (await res.json()).result.structuredContent.id))!.sender).toBeUndefined();
  });
  test("an open instance ignores the bearer", async () => {
    delete process.env.NOTEFEED_PASSWORD;
    expect((await rpc("tools/list", {}, bearer("garbage"))).status).toBe(200);
  });
});

describe("edit_note and delete_note", () => {
  test("work on an open feed", async () => {
    const id = (await call("post_note", { feed: "o", markdown: "# Old" })).structuredContent.id;
    const e = await call("edit_note", { feed: "o", id, markdown: "# New" });
    expect(e.structuredContent).toMatchObject({ id, type: "text/markdown", title: "New", content: "# New" });
    expect((await call("get_note", { feed: "o", id })).structuredContent.content).toBe("# New");
    expect((await call("delete_note", { feed: "o", id })).structuredContent).toEqual({ deleted: true });
    expect((await call("get_note", { feed: "o", id })).isError).toBe(true);
  });
  test("a protected feed needs the password", async () => {
    const id = (await call("post_note", { feed: "p", markdown: "# Old", password: "pw" })).structuredContent.id;
    for (const [tool, args] of [["edit_note", { markdown: "# New" }], ["delete_note", {}]] as const) {
      expect((await call(tool, { feed: "p", id, ...args })).content[0].text).toBe("missing or wrong password");
      expect((await call(tool, { feed: "p", id, ...args, password: "bad" })).isError).toBe(true);
    }
    expect((await call("edit_note", { feed: "p", id, markdown: "# New", password: "pw" })).isError).toBeUndefined();
    expect((await call("delete_note", { feed: "p", id, password: "pw" })).isError).toBeUndefined();
  });
  test("a missing note is a readable error", async () => {
    await call("post_note", { feed: "o", markdown: "# Old" });
    for (const [tool, args] of [["edit_note", { markdown: "# New" }], ["delete_note", {}]] as const) {
      const r = await call(tool, { feed: "o", id: "20260101T000000Z-x", ...args });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toBe("no such note");
    }
  });
});

describe("feed tools", () => {
  test("get, update and delete a feed", async () => {
    await call("post_note", { feed: "f", markdown: "# Hi" });
    const u = await call("update_feed", { feed: "f", title: "T", description: "D" });
    expect(u.structuredContent).toMatchObject({ name: "f", title: "T", description: "D", protected: false });
    expect((await call("get_feed", { feed: "f" })).structuredContent).toEqual(u.structuredContent);
    expect((await call("update_feed", { feed: "f", title: "x".repeat(101), description: "" })).isError).toBe(true);
    expect((await call("delete_feed", { feed: "f" })).structuredContent).toEqual({ deleted: true });
    expect((await call("get_feed", { feed: "f" })).content[0].text).toBe("no such feed");
  });
  test("a protected feed needs the password", async () => {
    await call("post_note", { feed: "p", markdown: "# Hi", password: "pw" });
    for (const [tool, args] of [["get_feed", {}], ["update_feed", { title: "T", description: "" }], ["delete_feed", {}]] as const) {
      expect((await call(tool, { feed: "p", ...args })).content[0].text).toBe("missing or wrong password");
    }
    expect((await call("delete_feed", { feed: "p", password: "pw" })).structuredContent).toEqual({ deleted: true });
  });
});

describe("post_note attachments", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest")]).toString("base64");
  const att = (name: string, extra: Record<string, unknown> = {}) => ({ name, type: "image/png", data: png, ...extra });
  test("posts the images, then the text with the references swapped or appended", async () => {
    const r = (await call("post_note", { feed: "f", markdown: "hi ![](a.png)", attachments: [att("a.png"), att("b.png", { alt: "B" })] })).structuredContent;
    expect(r.attachments).toHaveLength(2);
    const [a, b] = r.attachments;
    expect(a.file).not.toBe(b.file);
    expect((await getNote("f", r.id))!.content).toBe(`hi ![](${a.file})\n\n![](${b.file})`);
    expect((await listNotes("f", 10)).length).toBe(3);
    expect(await getNote("f", b.id)).toMatchObject({ type: "image/png", alt: "B" });
  });
  test("without attachments the answer has an empty list", async () => {
    expect((await call("post_note", { feed: "f", markdown: "x" })).structuredContent.attachments).toEqual([]);
  });
  test("validation refuses before anything is posted", async () => {
    for (const attachments of [[att("a.png"), att("a.png")], [att("a/b.png")], [att("..")], [att("a.md", { type: "text/markdown" })], [att("a.svg", { type: "image/svg+xml" })]]) {
      expect((await call("post_note", { feed: "f", markdown: "x", attachments })).isError).toBe(true);
    }
    expect(await hasFeed("f")).toBe(false);
  });
  test("a failed attachment names it and posts nothing", async () => {
    const bad = att("b.png", { data: Buffer.from("not a png").toString("base64") });
    const r = await call("post_note", { feed: "f", markdown: "x", attachments: [att("a.png"), bad] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^attachment "b\.png":/);
    expect(await listNotes("f", 10)).toHaveLength(0);
  });
  test("data that is not base64 is a clear error naming the attachment", async () => {
    const r = await call("post_note", { feed: "f", markdown: "x", attachments: [att("a.png", { data: "!!not base64!!" })] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^attachment "a\.png": .*base64/);
    expect(await hasFeed("f")).toBe(false);
  });
  test("a valid 6 MB picture is accepted", async () => {
    vi.stubEnv("NOTEFEED_MAX_IMAGE_BYTES", "8388608"); // afterEach unstubs it, also when the call throws
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(6_000_000, 1)]).toString("base64");
    const r = await call("post_note", { feed: "f", markdown: "x", attachments: [att("a.png", { data: big })] });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.attachments).toHaveLength(1);
  });
  test("an oversized image is refused before anything is posted", async () => {
    vi.stubEnv("NOTEFEED_MAX_IMAGE_BYTES", "10");
    const small = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
    const r = await call("post_note", { feed: "f", markdown: "x", attachments: [att("a.png", { data: small }), att("b.png")] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^attachment "b\.png":/);
    expect(await hasFeed("f")).toBe(false);
  });
  test("a text too large posts nothing, pictures included", async () => {
    const r = await call("post_note", { feed: "f", markdown: "x".repeat(110_000), attachments: [att("a.png")] });
    expect(r.isError).toBe(true);
    expect(await hasFeed("f")).toBe(false);
  });
  test("a titled reference and a definition are swapped", async () => {
    const r = (await call("post_note", { feed: "f", markdown: '![x](a.png "T") and ![y][r]\n\n[r]: b.png', attachments: [att("a.png"), att("b.png")] })).structuredContent;
    const [a, b] = r.attachments;
    expect((await getNote("f", r.id))!.content).toBe(`![x](${a.file} "T") and ![y][r]\n\n[r]: ${b.file}`);
  });
  test("a file name with a space is referenced percent-encoded", async () => {
    const r = (await call("post_note", { feed: "f", markdown: "![](a%20b.png)", attachments: [att("a b.png")] })).structuredContent;
    expect(r.attachments).toHaveLength(1);
    expect((await getNote("f", r.id))!.content).toBe(`![](${r.attachments[0].file})`);
  });
  test("empty markdown posts only the references", async () => {
    const r = (await call("post_note", { feed: "f", markdown: "", attachments: [att("a.png")] })).structuredContent;
    expect((await getNote("f", r.id))!.content).toBe(`![](${r.attachments[0].file})`);
  });
  test("the feed password goes on every request", async () => {
    await call("post_note", { feed: "p", markdown: "x", password: "pw", attachments: [att("a.png")] });
    expect((await call("list_notes", { feed: "p" })).isError).toBe(true);
    expect((await call("list_notes", { feed: "p", password: "pw" })).structuredContent.notes).toHaveLength(2);
    const r = (await call("post_note", { feed: "q", markdown: "x", password: "pw", attachments: [att("a.png"), att("b.png")] })).structuredContent;
    expect((await call("list_notes", { feed: "q" })).isError).toBe(true);
    expect((await call("list_notes", { feed: "q", password: "pw" })).structuredContent.notes).toHaveLength(3);
    expect(r.attachments).toHaveLength(2);
    // A picture the call stored is a note of the protected feed: not read without the password either.
    const picture = r.attachments[0].id;
    expect((await call("get_note", { feed: "q", id: picture })).isError).toBe(true);
    expect((await call("get_note", { feed: "q", id: picture, password: "pw" })).structuredContent).toMatchObject({ id: picture, type: "image/png" });
  });
});

describe("post_file", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest")]).toString("base64");
  test("stores a picture as a note of its own, and update_feed can make it the title image", async () => {
    await call("post_note", { feed: "i", markdown: "# Hi" });
    const r = (await call("post_file", { feed: "i", type: "image/png", data: png, title: "Cat", alt: "a cat", name: "cat.png" })).structuredContent;
    expect(r.file).toBe(`${r.id}.png`);
    expect(r.url).toBe(`http://localhost:3000/r/${(await readIdOf("i"))!}/${r.file}`);
    const n = (await call("get_note", { feed: "i", id: r.id })).structuredContent;
    expect(n).toMatchObject({ type: "image/png", title: "Cat" });
    expect(n.content).toBeUndefined();
    const f = await call("update_feed", { feed: "i", title: "", description: "", image: r.file });
    expect(f.structuredContent.image_url).toBe(r.url);
  });
  test("a text file can be posted too: the type is the file's, not the tool's", async () => {
    const r = (await call("post_file", { feed: "t", type: "text/markdown", data: Buffer.from("# From a file").toString("base64") })).structuredContent;
    expect((await call("get_note", { feed: "t", id: r.id })).structuredContent).toMatchObject({ type: "text/markdown", content: "# From a file" });
  });
  test("post_file cleans the file name like the HTTP post does", async () => {
    const data = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("x")]).toString("base64");
    const r = (await call("post_file", { feed: "names", type: "image/png", data, name: "../my\ncat/pic.png" })).structuredContent;
    const sidecar = JSON.parse(await (await import("node:fs/promises")).readFile(join(process.env.DATA_DIR!, "names", `.${r.file}.json`), "utf8"));
    expect(sidecar.name).toBe("..mycatpic.png");
  });
  test("refuses a type that is not accepted, a body that is not that type, too much, and a protected feed without the password", async () => {
    await call("post_note", { feed: "i", markdown: "# Hi" });
    const bad = await call("post_file", { feed: "i", type: "application/pdf", data: png });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("image/png");
    expect((await call("post_file", { feed: "i", type: "image/png", data: Buffer.from("nope").toString("base64") })).isError).toBe(true);
    expect((await call("post_file", { feed: "i", type: "image/jpeg", data: png })).isError).toBe(true);
    vi.stubEnv("NOTEFEED_MAX_IMAGE_BYTES", "10");
    expect((await call("post_file", { feed: "i", type: "image/png", data: png })).isError).toBe(true);
    vi.unstubAllEnvs(); // the default limit again
    await call("post_note", { feed: "p", markdown: "# Hi", password: "pw" });
    expect((await call("post_file", { feed: "p", type: "image/png", data: png })).content[0].text).toBe("missing or wrong password");
  });
});

describe("edit_note validates before it changes anything", () => {
  test("valid text with a bad title replaces nothing, and the answer says the edit failed", async () => {
    const id = (await call("post_note", { feed: "v", markdown: "# Old" })).structuredContent.id;
    const e = await call("edit_note", { feed: "v", id, markdown: "# New", title: "x".repeat(101) });
    expect(e.isError).toBe(true);
    expect((await call("get_note", { feed: "v", id })).structuredContent.content).toBe("# Old");
    const none = await call("edit_note", { feed: "v", id });
    expect(none.isError).toBe(true);
  });
});
