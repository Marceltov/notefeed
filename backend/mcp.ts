// The MCP endpoint: POST /mcp, protocol 2026-07-28 only, three tools over the same backend the HTTP API uses.
import { McpServer, createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import * as z from "zod";
import { NotefeedError, NotFoundError } from "./errors";
import { FEED_RE, readId } from "./feeds";
import { clientIp } from "./limits";
import { getNote, listNotes, type Note } from "./notes";
import { postNote } from "./posting";
import { feedPath, publicUrl, rssPath } from "./urls";

const SECRET_NOTE = "The feed name works like a password: anyone who knows it can read and post. Don't repeat it in replies.";

const feed = z.string().regex(FEED_RE);
const NoteSummary = z.object({ id: z.string(), title: z.string(), created_at: z.string(), url: z.string() });
const NoteFull = NoteSummary.extend({ markdown: z.string() });

// A tool result: the body as structured content and, for clients that only read text, as JSON text.
const ok = <T extends object>(body: T) => ({ structuredContent: body, content: [{ type: "text" as const, text: JSON.stringify(body) }] });

// NotefeedErrors are refusals the model can read. The SDK turns any other throw into a tool error carrying its
// message (an ENOENT would leak a path), so those are logged here and the client only gets "internal error".
function guard<A, R>(f: (args: A) => Promise<R>) {
  return async (args: A) => {
    try {
      return await f(args);
    } catch (e) {
      if (e instanceof NotefeedError) return { isError: true as const, content: [{ type: "text" as const, text: e.message }] };
      console.error("mcp tool failed", e);
      return { isError: true as const, content: [{ type: "text" as const, text: "internal error" }] };
    }
  };
}

function server(h: Headers): McpServer {
  const base = publicUrl(h);
  const summary = (feed: string, n: Note) => ({ id: n.id, title: n.title, created_at: n.createdAt.toISOString(), url: `${base}${feedPath(feed)}/${n.id}` });
  const s = new McpServer({ name: "notefeed", version: "1.0.0" });

  s.registerTool(
    "post_note",
    {
      description: `Post a markdown note to a feed; the feed is created by its first note. ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, markdown: z.string() }),
      outputSchema: z.object({ id: z.string(), url: z.string(), feed_url: z.string(), read_url: z.string() }),
    },
    guard(async ({ feed, markdown }) => {
      const note = await postNote(feed, clientIp(h), async () => markdown);
      const feedUrl = base + feedPath(feed);
      return ok({ id: note.id, url: `${feedUrl}/${note.id}`, feed_url: feedUrl, read_url: base + rssPath(readId(feed)) });
    }),
  );

  s.registerTool(
    "list_notes",
    {
      description: `List a feed's notes, newest first, without their markdown. Pass the returned next as before for the next page. ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, limit: z.number().int().min(1).max(100).default(20), before: z.string().optional() }),
      outputSchema: z.object({ notes: z.array(NoteSummary), next: z.string().nullable() }),
      annotations: { readOnlyHint: true },
    },
    guard(async ({ feed, limit, before }) => {
      const found = await listNotes(feed, limit + 1, before); // one extra: is there a next page?
      const shown = found.slice(0, limit);
      return ok({ notes: shown.map((n) => summary(feed, n)), next: found.length > limit ? shown[shown.length - 1].id : null });
    }),
  );

  s.registerTool(
    "get_note",
    {
      description: `Get one note with its markdown. ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, id: z.string() }),
      outputSchema: NoteFull,
      annotations: { readOnlyHint: true },
    },
    guard(async ({ feed, id }) => {
      const note = await getNote(feed, id);
      if (!note) throw new NotFoundError("no such note");
      return ok({ ...summary(feed, note), markdown: note.markdown });
    }),
  );
  return s;
}

// The SDK warns on every JSON-mode handler that mid-call notifications are dropped; none of our tools send any.
const warn = console.warn;
console.warn = () => {};
const handler = createMcpHandler(({ requestInfo }) => server(requestInfo!.headers), { legacy: "reject", responseMode: "json" });
console.warn = warn;

const rpcError = (status: number, message: string) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32600, message } }, { status });

// What may reach the handler. The SDK doesn't check Origin, so a browser page of another site can't drive
// this endpoint: no Origin (server-side clients) passes, a present one must be our own host.
function gate(req: Request): Response | AuthInfo | undefined {
  const origin = req.headers.get("origin");
  if (origin === null) return undefined;
  let host: string | null = null;
  try {
    host = new URL(origin).host;
  } catch {}
  if (host !== new URL(publicUrl(req.headers)).host) return rpcError(403, "forbidden origin");
  return undefined;
}

export async function mcpRoute(req: Request): Promise<Response> {
  const auth = gate(req);
  if (auth instanceof Response) return auth;
  return handler.fetch(req, { authInfo: auth });
}
