import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readIdOf, resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";
import { createNote } from "./notes";
import { mcpRoute } from "./mcp";
import { sign } from "./oauth/tokens";

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
afterEach(() => vi.restoreAllMocks());

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
    expect(tools.map((t: { name: string }) => t.name).sort()).toEqual(["delete_note", "edit_note", "get_note", "list_notes", "post_note"]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint === true).toBe(["get_note", "list_notes"].includes(t.name));
      expect(t.annotations?.destructiveHint === true).toBe(["edit_note", "delete_note"].includes(t.name));
      expect(t.annotations?.idempotentHint === true).toBe(t.name === "edit_note");
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
    });
    expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent);
  });

  test("post_note to a feed without a read link answers read_url null", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await mkdir(join(dir, "nolink", ".readid"), { recursive: true }); // can't be read
    const r = await call("post_note", { feed: "nolink", markdown: "# Hi" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.read_url).toBeNull();
  });

  test("list_notes pages newest first without markdown", async () => {
    const ids: string[] = [];
    for (const [i, m] of ["# One", "# Two", "# Three"].entries()) ids.push((await createNote("a", m, new Date(Date.UTC(2026, 8, 29, 10 + i)))).note.id);
    const first = (await call("list_notes", { feed: "a", limit: 2 })).structuredContent;
    expect(first.notes).toHaveLength(2);
    expect(first.notes[0].id).toBe(ids[2]);
    for (const n of first.notes) expect(Object.keys(n).sort()).toEqual(["created_at", "id", "title", "url"]);
    expect(first.next).toBe(first.notes[1].id);
    const rest = (await call("list_notes", { feed: "a", limit: 2, before: first.next })).structuredContent;
    expect(rest.notes).toHaveLength(1);
    expect(rest.next).toBeNull();
  });

  test("get_note", async () => {
    const { id } = (await call("post_note", { feed: "a", markdown: "# Hi\nbody" })).structuredContent;
    const n = (await call("get_note", { feed: "a", id })).structuredContent;
    expect(n).toEqual({ id, title: "Hi", markdown: "# Hi\nbody", created_at: expect.any(String), url: `http://localhost:3000/a/${id}` });
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
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await writeFile(join(dir, "file"), "");
    process.env.DATA_DIR = join(dir, "file"); // a file where the data directory should be
    resetFeedsForTests();
    const r = await call("post_note", { feed: "a", markdown: "x" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("internal error");
    expect(log).toHaveBeenCalledOnce();
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
  test("an open instance ignores the bearer", async () => {
    delete process.env.NOTEFEED_PASSWORD;
    expect((await rpc("tools/list", {}, bearer("garbage"))).status).toBe(200);
  });
});

describe("edit_note and delete_note", () => {
  test("work on an open feed", async () => {
    const id = (await call("post_note", { feed: "o", markdown: "# Old" })).structuredContent.id;
    const e = await call("edit_note", { feed: "o", id, markdown: "# New" });
    expect(e.structuredContent).toMatchObject({ id, title: "New", markdown: "# New" });
    expect((await call("get_note", { feed: "o", id })).structuredContent.markdown).toBe("# New");
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
