// The MCP endpoint: POST /mcp, protocol 2026-07-28 only, five tools over the same backend the HTTP API uses.
import { McpServer, createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import * as z from "zod";
import { bearerOf, checkBearer, locked } from "./auth";
import { AuthError, NotefeedError, NotFoundError, TooManyAttemptsError } from "./errors";
import { checkFeedAccess } from "./feedlock";
import { assertFeed, FEED_RE, readId } from "./feeds";
import { clientIp } from "./limits";
import { getNote, listNotes, type Note } from "./notes";
import { verify } from "./oauth/tokens";
import { deleteNote, editNote, postNote } from "./posting";
import { feedPath, mcpResource, publicUrl, rssPath } from "./urls";

const SECRET_NOTE = "The feed name works like a password: anyone who knows it can read and post. Don't repeat it in replies.";

const feed = z.string().regex(FEED_RE);
const password = z.string().optional();
const PROTECTED = "A protected feed needs its password as password.";
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
  // A reserved name must not reach the filesystem lookup, so it is checked first.
  const checkAccess = async (feed: string, password?: string) => {
    assertFeed(feed);
    await checkFeedAccess(feed, { password }, clientIp(h));
  };
  const s = new McpServer({ name: "notefeed", version: "1.0.0" });

  s.registerTool(
    "post_note",
    {
      description: `Post a markdown note to a feed; the feed is created by its first note; a password given then protects the feed for good, and is refused on a feed that already exists. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, markdown: z.string(), password }),
      outputSchema: z.object({ id: z.string(), url: z.string(), feed_url: z.string(), read_url: z.string() }),
    },
    guard(async ({ feed, markdown, password }) => {
      const { note } = await postNote(feed, clientIp(h), async () => ({ markdown }), { password });
      const feedUrl = base + feedPath(feed);
      return ok({ id: note.id, url: `${feedUrl}/${note.id}`, feed_url: feedUrl, read_url: base + rssPath(readId(feed)) });
    }),
  );

  s.registerTool(
    "list_notes",
    {
      description: `List a feed's notes, newest first, without their markdown. Pass the returned next as before for the next page. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, limit: z.number().int().min(1).max(100).default(20), before: z.string().optional(), password }),
      outputSchema: z.object({ notes: z.array(NoteSummary), next: z.string().nullable() }),
      annotations: { readOnlyHint: true },
    },
    guard(async ({ feed, limit, before, password }) => {
      await checkAccess(feed, password);
      const found = await listNotes(feed, limit + 1, before); // one extra: is there a next page?
      const shown = found.slice(0, limit);
      return ok({ notes: shown.map((n) => summary(feed, n)), next: found.length > limit ? shown[shown.length - 1].id : null });
    }),
  );

  s.registerTool(
    "get_note",
    {
      description: `Get one note with its markdown. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, id: z.string(), password }),
      outputSchema: NoteFull,
      annotations: { readOnlyHint: true },
    },
    guard(async ({ feed, id, password }) => {
      await checkAccess(feed, password);
      const note = await getNote(feed, id);
      if (!note) throw new NotFoundError("no such note");
      return ok({ ...summary(feed, note), markdown: note.markdown });
    }),
  );

  s.registerTool(
    "edit_note",
    {
      description: `Replace a note's markdown; its id stays. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, id: z.string(), markdown: z.string(), password }),
      outputSchema: NoteFull,
    },
    guard(async ({ feed, id, markdown, password }) => {
      const note = await editNote(feed, id, clientIp(h), async () => ({ markdown }), { password });
      return ok({ ...summary(feed, note), markdown: note.markdown });
    }),
  );

  s.registerTool(
    "delete_note",
    {
      description: `Permanently delete a note. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, id: z.string(), password }),
      outputSchema: z.object({ deleted: z.literal(true) }),
      annotations: { destructiveHint: true },
    },
    guard(async ({ feed, id, password }) => {
      await deleteNote(feed, id, clientIp(h), { password });
      return ok({ deleted: true as const });
    }),
  );
  return s;
}

// "auto" answers with one JSON body unless a tool emits mid-call notifications, which ours never do.
const handler = createMcpHandler(({ requestInfo }) => server(requestInfo!.headers), { legacy: "reject" });

const rpcError = (status: number, message: string, headers?: Record<string, string>) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32600, message } }, { status, headers });

// What may reach the handler. The SDK doesn't check Origin, so a browser page of another site can't drive
// this endpoint: no Origin (server-side clients) passes, a present one must be our own host. That stops
// DNS rebinding only when PUBLIC_URL is set; without it our host comes from the request's own Host header.
// A locked instance then wants an OAuth access token minted for this resource, or the password as the bearer.
function gate(req: Request): Response | AuthInfo | undefined {
  const origin = req.headers.get("origin");
  if (origin !== null) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {}
    if (host !== new URL(publicUrl(req.headers)).host) return rpcError(403, "forbidden origin");
  }
  if (!locked()) return undefined;
  const unauthorized = (message: string, error = "") =>
    rpcError(401, message, { "www-authenticate": `Bearer ${error}resource_metadata="${publicUrl(req.headers)}/.well-known/oauth-protected-resource/mcp"` });
  const authorization = req.headers.get("authorization");
  const token = bearerOf(authorization);
  // An access token we signed (now = 0 ignores expiry) is never a password guess: when it has expired or
  // names another resource, invalid_token tells the client to refresh, and no failed attempt is counted.
  if (verify("access", token, 0)) {
    if (verify("access", token)?.aud === mcpResource(req.headers)) return { token, clientId: "oauth", scopes: [] };
    return unauthorized("invalid token", 'error="invalid_token", ');
  }
  try {
    checkBearer(authorization, clientIp(req.headers));
  } catch (e) {
    if (e instanceof TooManyAttemptsError) return rpcError(429, e.message, { "retry-after": String(e.retryAfter) });
    if (e instanceof AuthError) return unauthorized(e.message);
    throw e;
  }
  return { token: "", clientId: "password", scopes: [] };
}

export async function mcpRoute(req: Request): Promise<Response> {
  const auth = gate(req);
  if (auth instanceof Response) return auth;
  return handler.fetch(req, { authInfo: auth });
}
