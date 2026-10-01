import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { readId, resetFeedsForTests } from "./feeds";
import { resetRateLimitsForTests } from "./limits";
import { createNote } from "./notes";
import { mcpRoute } from "./mcp";

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
    expect(tools.map((t: { name: string }) => t.name).sort()).toEqual(["get_note", "list_notes", "post_note"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint === true).toBe(t.name !== "post_note");
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
  test("post_note", async () => {
    const r = await call("post_note", { feed: "a", markdown: "# Hi" });
    const { id } = r.structuredContent;
    expect(r.structuredContent).toEqual({
      id,
      url: `http://localhost:3000/a/${id}`,
      feed_url: "http://localhost:3000/a",
      read_url: `http://localhost:3000/r/${readId("a")}/feed.xml`,
    });
    expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent);
  });

  test("list_notes pages newest first without markdown", async () => {
    const ids: string[] = [];
    for (const [i, m] of ["# One", "# Two", "# Three"].entries()) ids.push((await createNote("a", m, new Date(Date.UTC(2026, 8, 29, 10 + i)))).id);
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
    log.mockRestore();
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
