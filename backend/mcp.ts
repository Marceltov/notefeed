// The MCP endpoint: POST /mcp, protocol 2026-07-28 only, nine tools over the same backend the HTTP API uses.
import { McpServer, createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import * as z from "zod";
import { bearerOf, checkBearer, locked } from "./auth";
import { config } from "./config";
import { AuthError, ImageTooLargeError, InvalidBodyError, NotefeedError, NotFoundError, TooManyAttemptsError, UnsupportedTypeError } from "./errors";
import { checkFeedAccess } from "./feedlock";
import { assertFeed, FEED_RE, hasFeed } from "./feeds";
import { feedJson } from "./http/api";
import { sender } from "./http/request";
import { clientIp } from "./limits";
import { ACCEPTED_TYPES } from "./note/media";
import { parseMediaType } from "./note/types";
import { logger } from "./log";
import { checkLine, getNote, listNotes, MAX_NOTE_TITLE, type Note } from "./notes";
import { verify } from "./oauth/tokens";
import { isAttachmentName } from "../shared/links";
import { TAG_RULE } from "./tags";
import { deleteFeed, deleteNote, editContent, editMeta, postNote, postWithPictures, updateFeed } from "./posting";
import { feedPath, imagePath, mcpResource, publicUrl, rssPath } from "./urls";

const log = logger("mcp");
const SECRET_NOTE = "The feed name works like a password: anyone who knows it can read and post. Don't repeat it in replies.";

const feed = z.string().regex(FEED_RE);
const password = z.string().optional();
const PROTECTED = "A protected feed needs its password as password.";
const NoteSummary = z.object({ id: z.string(), type: z.string(), title: z.string(), created_at: z.string(), url: z.string(), sender: z.string().optional(), tags: z.array(z.string()) });
const NoteFull = NoteSummary.extend({ content: z.string().optional() }); // the text of a text type; a picture has none

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
      log.error({ err: e }, "tool failed");
      return { isError: true as const, content: [{ type: "text" as const, text: "internal error" }] };
    }
  };
}

function server(h: Headers): McpServer {
  const base = publicUrl(h);
  const summary = (feed: string, n: Note) => ({ id: n.id, type: n.type, title: n.title, created_at: n.createdAt.toISOString(), url: `${base}${feedPath(feed)}/${n.id}`, ...(n.sender !== undefined && { sender: n.sender }), tags: n.tags });
  // A reserved name must not reach the filesystem lookup, so it is checked first.
  const checkAccess = async (feed: string, password?: string) => {
    assertFeed(feed);
    await checkFeedAccess(feed, { password }, clientIp(h));
  };
  const s = new McpServer({ name: "notefeed", version: "1.0.0" });

  // One file as a note: the type must be accepted and the bytes must be what it says (postNote checks that); a picture is size-limited.
  const postBytes = async (feed: string, f: { type: string; data: string; title?: string; alt?: string; name?: string; tags?: string[] }, password: string | undefined) => {
    const parsed = parseMediaType(f.type);
    if (!parsed) throw new UnsupportedTypeError();
    const body = Buffer.from(f.data, "base64");
    if (parsed.type.name === "image" && body.length > config.maxImageBytes()) throw new ImageTooLargeError();
    return postNote(feed, clientIp(h), async () => ({ body, mediaType: parsed.mediaType, title: f.title, alt: f.alt, name: f.name, tags: f.tags }), { password }, sender(h));
  };
  const fileUrl = (readId: string | null, file: string) => (readId ? base + imagePath(readId, file) : "");

  s.registerTool(
    "post_note",
    {
      description: `Post a markdown note to a feed; the feed is created by its first note; a password given then protects the feed for good, and is refused on a feed that already exists. attachments are pictures posted with the note, each as a note of its own: write ![](name) in the markdown where one goes (a name with spaces as ![](<name with spaces>) or ![](name%20with%20spaces); a title after it is fine; an attachment the text never refers to is added at the end); all or nothing, a refusal posts nothing. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({
        feed,
        markdown: z.string(),
        title: z.string().optional().describe("The note's title (at most 100 characters, one line); left out, it is taken from the text"),
        password,
        tags: z.array(z.string()).optional().describe(`Labels for the note, e.g. ["ci","deploy"]: ${TAG_RULE}. Not verified; readers see them.`),
        read_id: z.string().optional().describe("Only when this post creates the feed: its read id (3 to 64 characters of a-z, 0-9, - and _), random when left out. A short readable one is guessable. Fails if taken."),
        attachments: z
          .array(z.object({ name: z.string().refine(isAttachmentName, "Not a file name: 1 to 200 characters, no / or \\, no control characters, no leading or trailing space").describe("What the markdown calls it: ![](name). Any single path segment (no / or \\; spaces allowed, written <name with spaces> or name%20with%20spaces in the markdown); unique"), type: z.string().describe(`The picture's media type: ${ACCEPTED_TYPES}`), data: z.string().describe("The picture's bytes, standard base64 (not URL-safe)"), alt: z.string().optional().describe("Alternative text (at most 500 characters, one line)") }))
          .optional(),
      }),
      outputSchema: z.object({ id: z.string(), url: z.string(), feed_url: z.string(), read_url: z.string().nullable(), attachments: z.array(z.object({ id: z.string(), file: z.string(), url: z.string() })) }),
    },
    guard(async ({ feed, markdown, title, password, tags, read_id, attachments = [] }) => {
      // Buffer.from skips what is not base64, so the data is checked here; the rest of the checks are postWithPictures's.
      const pictures = attachments.map((a) => {
        const clean = a.data.replace(/\s/g, "");
        const body = Buffer.from(clean, "base64");
        if (body.toString("base64").replace(/=+$/, "") !== clean.replace(/=+$/, "")) throw new InvalidBodyError(`attachment "${a.name}": data is not valid base64`);
        return { name: a.name, body, mediaType: a.type, alt: a.alt };
      });
      const { note, readId, pictures: stored } = await postWithPictures(feed, clientIp(h), async () => ({ text: markdown, pictures, title, tags, password, readId: read_id }), { password }, sender(h));
      const feedUrl = base + feedPath(feed);
      return ok({ id: note.id, url: `${feedUrl}/${note.id}`, feed_url: feedUrl, read_url: readId && base + rssPath(readId), attachments: stored.map((p) => ({ id: p.id, file: p.file, url: fileUrl(readId, p.file) })) });
    }),
  );

  s.registerTool(
    "list_notes",
    {
      description: `List a feed's notes, newest first, without their content. Pass the returned next as before for the next page. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, limit: z.number().int().min(1).max(100).default(20), before: z.string().optional(), tag: z.string().optional().describe("Only notes carrying this tag"), password }),
      outputSchema: z.object({ notes: z.array(NoteSummary), next: z.string().nullable() }),
      annotations: { readOnlyHint: true },
    },
    guard(async ({ feed, limit, before, tag, password }) => {
      await checkAccess(feed, password);
      const found = await listNotes(feed, limit + 1, before, tag?.toLowerCase()); // one extra: is there a next page?
      const shown = found.slice(0, limit);
      return ok({ notes: shown.map((n) => summary(feed, n)), next: found.length > limit ? shown[shown.length - 1].id : null });
    }),
  );

  s.registerTool(
    "get_note",
    {
      description: `Get one note with its content (the text of a text note; a picture has none, use its URL). ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, id: z.string(), password }),
      outputSchema: NoteFull,
      annotations: { readOnlyHint: true },
    },
    guard(async ({ feed, id, password }) => {
      await checkAccess(feed, password);
      const note = await getNote(feed, id);
      if (!note) throw new NotFoundError("no such note");
      return ok({ ...summary(feed, note), ...(note.content !== undefined && { content: note.content }) });
    }),
  );

  s.registerTool(
    "edit_note",
    {
      description: `Replace a note's markdown, set its title, or both (an empty title removes it: the title follows the text again); its id stays. At least one of markdown and title. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, id: z.string(), markdown: z.string().optional(), title: z.string().optional(), password }),
      outputSchema: NoteFull,
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    guard(async ({ feed, id, markdown, title, password }) => {
      if (markdown === undefined && title === undefined) throw new InvalidBodyError("nothing to change: send markdown, title or both");
      checkLine("title", title, MAX_NOTE_TITLE); // before the content is replaced: a bad title must not leave a half edit
      let note = markdown === undefined ? undefined : await editContent(feed, id, clientIp(h), async () => ({ body: new TextEncoder().encode(markdown), mediaType: "text/markdown" }), { password });
      if (title !== undefined) note = await editMeta(feed, id, clientIp(h), async () => ({ title }), { password });
      return ok({ ...summary(feed, note!), ...(note!.content !== undefined && { content: note!.content }) });
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

  const FeedOut = z.object({ name: z.string(), title: z.string(), description: z.string(), protected: z.boolean(), read_url: z.string().nullable(), image_url: z.string().nullable() });

  s.registerTool(
    "get_feed",
    {
      description: `Get a feed's title, description, title image, whether it is protected, and its read link (null while it has no notes). ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, password }),
      outputSchema: FeedOut,
      annotations: { readOnlyHint: true },
    },
    guard(async ({ feed, password }) => {
      await checkAccess(feed, password);
      if (!(await hasFeed(feed))) throw new NotFoundError("no such feed");
      return ok(await feedJson(feed, h));
    }),
  );

  s.registerTool(
    "update_feed",
    {
      description: `Replace a feed's title (at most 100 characters) and description (at most 500), both one line; an empty title shows the feed's name. image is the file name upload_image returned for this feed (the title image), empty to remove it, left out to keep it. read_id gives the feed another read link (3 to 64 characters of a-z, 0-9, - and _; empty for a random one; left out keeps it): the old link stops showing this feed and may later show another one, relative image links in notes follow, full URLs do not. The feed must exist. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, title: z.string(), description: z.string(), image: z.string().optional(), read_id: z.string().optional(), password }),
      outputSchema: FeedOut,
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    guard(async ({ feed, title, description, image, read_id, password }) => {
      await updateFeed(feed, clientIp(h), async () => ({ title, description, image, readId: read_id }), { password });
      return ok(await feedJson(feed, h));
    }),
  );

  s.registerTool(
    "delete_feed",
    {
      description: `Permanently delete a feed with all its notes, settings, password and read link. There is no undo. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({ feed, password }),
      outputSchema: z.object({ deleted: z.literal(true) }),
      annotations: { destructiveHint: true },
    },
    guard(async ({ feed, password }) => {
      await deleteFeed(feed, clientIp(h), { password });
      return ok({ deleted: true as const });
    }),
  );

  s.registerTool(
    "post_file",
    {
      description: `Post a file as a note, as base64 in data, with its media type in type: ${ACCEPTED_TYPES}. Nothing is guessed: the data must be what type says (an image has its format's signature, markdown is UTF-8). The feed is created by its first note. Returns the note's id, its file name and its public URL (public like the feed's read link). Pictures are stored as sent, EXIF included. ${PROTECTED} ${SECRET_NOTE}`,
      inputSchema: z.object({
        feed,
        type: z.string().describe("The file's media type"),
        data: z.string().describe("The file's bytes, base64"),
        title: z.string().optional().describe("The note's title (at most 100 characters, one line)"),
        alt: z.string().optional().describe("Alternative text of a picture (at most 500 characters, one line)"),
        name: z.string().optional().describe("The file's original name"),
        password,
      }),
      outputSchema: z.object({ id: z.string(), file: z.string(), url: z.string() }),
    },
    guard(async ({ feed, type, data, title, alt, name, password }) => {
      const { note, readId } = await postBytes(feed, { type, data, title, alt, name }, password);
      return ok({ id: note.id, file: note.file, url: fileUrl(readId, note.file) });
    }),
  );
  return s;
}

// The SDK's default of 4 MiB would refuse a valid 3 MB picture (base64 is a third larger); 16 MiB holds the largest picture (10 MiB) in base64.
// ponytail: one cap for every call; several large pictures in one call need a bigger one.
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;

// "auto" answers with one JSON body unless a tool emits mid-call notifications, which ours never do.
const handler = createMcpHandler(({ requestInfo }) => server(requestInfo!.headers), { legacy: "reject", maxRequestBodySize: MAX_REQUEST_BYTES });

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
