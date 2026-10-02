// The public REST API, /api/v1, defined in code: this table is the single source. `dispatch` serves
// requests through it, and openApiDocument() generates the OpenAPI 3.1 description the clients are
// generated from. Each handler is typed from its own declared responses (see op() in dispatch.ts).
import * as z from "zod";
import { config } from "../config";
import { InvalidBodyError, NotFoundError } from "../errors";
import { changePassword, checkFeedAccess, protectedFeed, removePassword } from "../feedlock";
import { READ_ID_RE, assertFeed, feedForReadId, hasFeed, readIdOf } from "../feeds";
import { getSettings } from "../feedsettings";
import { clientIp } from "../limits";
import { MAX_BYTES, countNotes, getNote, listNotes, type Note } from "../notes";
import { PASSWORD_RULE } from "../../shared/password";
import { API_PREFIX, feedPath, publicUrl, readPath, rssPath } from "../urls";
import { createDispatcher, op, type AnyOp, type ResponseSpec } from "./dispatch";
import { deleteFeed, deleteNote, editNote, updateFeed } from "../posting";
import { handlePostNote, readMarkdown } from "./notes";
import { authorize, feedAccess, readCapped } from "./request";
import {
  COMPONENTS,
  Created,
  CurrentPasswordHeader,
  ErrorJson,
  FeedJson,
  FeedParam,
  FeedPasswordHeader,
  FeedSettingsJson,
  NoteIdParam,
  NoteJson,
  NoteList,
  PageQuery,
  PasswordJson,
  PostForm,
  PostJson,
  ReadFeedJson,
  ReadIdParam,
} from "./schemas";

export { API_PREFIX };

const err = (description: string) => ({ description, schema: ErrorJson }) satisfies ResponseSpec;
const RETRY = { "Retry-After": { description: "Seconds to wait before trying again", type: "integer" } } as const;
const UNAUTHORIZED = err("The instance has a password, or the feed has its own, and it is missing or wrong");

// For the Feeds reads: the password first (a locked instance tells strangers nothing else), then the name.
// postNote does its own, because a browser form gets a redirect to the login page instead of a 401.
// The feed's own password comes after both: the instance lock is always checked first.
function passwordAndFeed({ req, params }: { req: Request; params: Record<string, string> }) {
  authorize(req.headers, clientIp(req.headers));
  assertFeed(params.feed);
}
async function passwordFeedAndFeedPassword(input: { req: Request; params: Record<string, string> }) {
  passwordAndFeed(input);
  await checkFeedAccess(input.params.feed, feedAccess(input.req.headers, input.params.feed), clientIp(input.req.headers));
}

// Wire form of a note; `base` is the absolute URL its page lives under.
const noteJson = (n: Note, base: string): NoteJson => ({
  id: n.id,
  title: n.title,
  markdown: n.markdown,
  created_at: n.createdAt.toISOString(),
  url: `${base}/${n.id}`,
});

// One page of notes, newest first, and the cursor for the next one.
async function page(notes: (limit: number, before?: string) => Promise<Note[]>, query: z.infer<typeof PageQuery>, base: string) {
  const found = await notes(query.limit + 1, query.before); // one extra: is there a next page?
  const shown = found.slice(0, query.limit);
  return {
    status: 200 as const,
    body: { notes: shown.map((n) => noteJson(n, base)), next: found.length > query.limit ? shown[shown.length - 1].id : null },
  };
}

// The feed as the Feeds API shows it; the feed must exist. No read link while it has no notes (ADR 0008).
export async function feedJson(feed: string, headers: Headers): Promise<z.infer<typeof FeedJson>> {
  const readId = (await countNotes(feed)) ? await readIdOf(feed) : null;
  return {
    name: feed,
    ...(await getSettings(feed)),
    protected: await protectedFeed(feed),
    read_url: readId && publicUrl(headers) + rssPath(readId),
  };
}

const OPS: AnyOp[] = [
  op({
    method: "POST",
    path: `${API_PREFIX}/feeds/{feed}/notes`,
    operationId: "postNote",
    summary: "Post a note",
    description:
      "Creates the feed with its first note, optionally protected by its own password (`X-Feed-Password` header or a `password` field in the JSON or form body; " +
      `${PASSWORD_RULE}). ` +
      "Posting to a protected feed needs that password. Also served at `POST /{feed}`, the short form the client packages and curl one-liners use. " +
      `The body is at most ${MAX_BYTES} bytes and must be UTF-8. ` +
      "`application/x-www-form-urlencoded` (what `curl -d` sends) is read as raw markdown, not as form fields.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam },
    headers: { "X-Feed-Password": FeedPasswordHeader },
    body: {
      "text/markdown": z.string(),
      "text/plain": z.string(),
      // What `curl -d` sends: read as raw markdown, not as form fields.
      "application/x-www-form-urlencoded": z.string(),
      "application/json": PostJson,
      "multipart/form-data": PostForm,
    },
    responses: {
      201: { description: "Stored", schema: Created },
      303: {
        description:
          "Only when the request accepts `text/html` (a browser submitting a form): back to the feed page with `?posted=<id>` or `?error=<code>`, or to the login page",
        headers: { Location: { description: "Where to go", type: "string" } },
      },
      400: err("Invalid or reserved feed name; empty note; bad JSON, form or UTF-8; a new password that is not printable ASCII"),
      401: UNAUTHORIZED,
      409: err("A password was sent for a feed that already exists without one: it can't be claimed"),
      413: err(`Body over ${MAX_BYTES} bytes`),
      415: err("Unsupported content type"),
      429: { ...err("Too many posts, or wrong passwords, from this client"), headers: RETRY },
      507: err("NOTEFEED_MAX_FEEDS or NOTEFEED_MAX_NOTES_PER_FEED reached"),
    },
  }).handle(({ req, params }) => handlePostNote(req, params.feed)),

  op({
    method: "GET",
    path: `${API_PREFIX}/feeds/{feed}/notes`,
    operationId: "listNotes",
    summary: "List a feed's notes",
    description: "Newest first. A feed with no notes (or that doesn't exist yet) is an empty list.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam },
    headers: { "X-Feed-Password": FeedPasswordHeader },
    query: PageQuery,
    responses: {
      200: { description: "A page of notes", schema: NoteList },
      400: err("Invalid or reserved feed name, or a bad `limit` / `before`"),
      401: UNAUTHORIZED,
      429: { ...err("Too many wrong passwords from this client"), headers: RETRY },
    },
    before: passwordFeedAndFeedPassword,
  }).handle(async ({ req, params, query }) => {
    return page((l, b) => listNotes(params.feed, l, b), query, publicUrl(req.headers) + feedPath(params.feed));
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/feeds/{feed}/notes/{id}`,
    operationId: "getNote",
    summary: "Get one note",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam, id: NoteIdParam },
    headers: { "X-Feed-Password": FeedPasswordHeader },
    responses: {
      200: { description: "The note", schema: NoteJson },
      400: err("Invalid or reserved feed name"),
      401: UNAUTHORIZED,
      404: err("No such note"),
      429: { ...err("Too many wrong passwords from this client"), headers: RETRY },
    },
    before: passwordFeedAndFeedPassword,
  }).handle(async ({ req, params }) => {
    const note = await getNote(params.feed, params.id);
    if (!note) throw new NotFoundError("no such note");
    return { status: 200, body: noteJson(note, publicUrl(req.headers) + feedPath(params.feed)) };
  }),

  op({
    method: "PUT",
    path: `${API_PREFIX}/feeds/{feed}/notes/{id}`,
    operationId: "editNote",
    summary: "Edit a note",
    description:
      "Replaces the note's markdown; its id and creation time stay, the title follows the new text. " +
      "Needs the feed's password if it has one, and counts against the post rate limit. Read links can't edit. " +
      `The body is as for posting: at most ${MAX_BYTES} bytes, UTF-8, a \`password\` field is ignored.`,
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam, id: NoteIdParam },
    headers: { "X-Feed-Password": FeedPasswordHeader },
    body: {
      "text/markdown": z.string(),
      "text/plain": z.string(),
      "application/x-www-form-urlencoded": z.string(),
      "application/json": PostJson,
      "multipart/form-data": PostForm,
    },
    responses: {
      200: { description: "The note as it is now", schema: NoteJson },
      400: err("Invalid or reserved feed name; empty note; bad JSON, form or UTF-8"),
      401: UNAUTHORIZED,
      404: err("No such note"),
      413: err(`Body over ${MAX_BYTES} bytes`),
      415: err("Unsupported content type"),
      429: { ...err("Too many posts, edits and deletes, or wrong passwords, from this client"), headers: RETRY },
    },
    before: passwordAndFeed,
  }).handle(async ({ req, params }) => {
    const ip = clientIp(req.headers);
    const note = await editNote(params.feed, params.id, ip, () => readMarkdown(req), feedAccess(req.headers, params.feed));
    return { status: 200, body: noteJson(note, publicUrl(req.headers) + feedPath(params.feed)) };
  }),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/feeds/{feed}/notes/{id}`,
    operationId: "deleteNote",
    summary: "Delete a note",
    description: "Needs the feed's password if it has one, and counts against the post rate limit. The feed stays, even with no notes left. Read links can't delete.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam, id: NoteIdParam },
    headers: { "X-Feed-Password": FeedPasswordHeader },
    responses: {
      204: { description: "Deleted" },
      400: err("Invalid or reserved feed name"),
      401: UNAUTHORIZED,
      404: err("No such note"),
      429: { ...err("Too many posts, edits and deletes, or wrong passwords, from this client"), headers: RETRY },
    },
    before: passwordAndFeed,
  }).handle(async ({ req, params }) => {
    await deleteNote(params.feed, params.id, clientIp(req.headers), feedAccess(req.headers, params.feed));
    return { status: 204, body: undefined };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/feeds/{feed}`,
    operationId: "getFeed",
    summary: "Get a feed's settings",
    description: "The title and description, whether the feed is protected, and its read link (null while it has no notes). A feed exists once its first note is posted.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam },
    headers: { "X-Feed-Password": FeedPasswordHeader },
    responses: {
      200: { description: "The feed", schema: FeedJson },
      400: err("Invalid or reserved feed name"),
      401: UNAUTHORIZED,
      404: err("No such feed"),
      429: { ...err("Too many wrong passwords from this client"), headers: RETRY },
    },
    before: passwordFeedAndFeedPassword,
  }).handle(async ({ req, params }) => {
    if (!(await hasFeed(params.feed))) throw new NotFoundError("no such feed");
    return { status: 200, body: await feedJson(params.feed, req.headers) };
  }),

  op({
    method: "PUT",
    path: `${API_PREFIX}/feeds/{feed}`,
    operationId: "updateFeed",
    summary: "Change a feed's settings",
    description:
      "Replaces both the title (at most 100 characters) and the description (at most 500); surrounding whitespace is trimmed and control characters are refused. " +
      "Needs the feed's password if it has one, and counts against the post rate limit. Only on a feed that exists: it is created by its first note. Read links can't change settings.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam },
    headers: { "X-Feed-Password": FeedPasswordHeader },
    body: { "application/json": FeedSettingsJson },
    responses: {
      200: { description: "The feed as it is now", schema: FeedJson },
      400: err("Invalid or reserved feed name, bad JSON, or a title or description that is too long or has control characters"),
      401: UNAUTHORIZED,
      404: err("No such feed"),
      429: { ...err("Too many posts, edits and deletes, or wrong passwords, from this client"), headers: RETRY },
    },
    before: passwordAndFeed,
  }).handle(async ({ req, params }) => {
    const read = async () => {
      const bytes = await readCapped(req, 8192);
      try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes ?? new Uint8Array()));
      } catch {
        throw new InvalidBodyError('JSON needs "title" and "description" strings');
      }
    };
    await updateFeed(params.feed, clientIp(req.headers), read, feedAccess(req.headers, params.feed));
    return { status: 200, body: await feedJson(params.feed, req.headers) };
  }),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/feeds/{feed}`,
    operationId: "deleteFeed",
    summary: "Delete a feed",
    description:
      "Deletes the feed with all its notes, its settings, its password and its read link, for good: there is no undo. The name is free again; " +
      "a feed created there later gets a new read link, and the old one answers like an unknown one. " +
      "Needs the feed's password if it has one, and counts against the post rate limit.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam },
    headers: { "X-Feed-Password": FeedPasswordHeader },
    responses: {
      204: { description: "Deleted" },
      400: err("Invalid or reserved feed name"),
      401: UNAUTHORIZED,
      404: err("No such feed"),
      429: { ...err("Too many posts, edits and deletes, or wrong passwords, from this client"), headers: RETRY },
    },
    before: passwordAndFeed,
  }).handle(async ({ req, params }) => {
    await deleteFeed(params.feed, clientIp(req.headers), feedAccess(req.headers, params.feed));
    return { status: 204, body: undefined };
  }),

  op({
    method: "PUT",
    path: `${API_PREFIX}/feeds/{feed}/password`,
    operationId: "changeFeedPassword",
    summary: "Change a feed's password",
    description: "Needs the current password in `X-Feed-Password`. A feed can only get a password when it is created, so an open feed answers 409.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam },
    headers: { "X-Feed-Password": CurrentPasswordHeader },
    body: { "application/json": PasswordJson },
    responses: {
      204: { description: "Changed; the old password and unlock cookies stop working" },
      400: err(`Invalid or reserved feed name, bad JSON, or a new password that is not ${PASSWORD_RULE}`),
      401: UNAUTHORIZED,
      409: err("The feed has no password"),
      429: { ...err("Too many wrong passwords from this client"), headers: RETRY },
    },
    before: passwordAndFeed,
  }).handle(async ({ req, params }) => {
    const bytes = await readCapped(req, 4096);
    let body: ReturnType<typeof PasswordJson.safeParse> | undefined;
    try {
      body = PasswordJson.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes ?? new Uint8Array())));
    } catch {}
    if (!body?.success) throw new InvalidBodyError('JSON needs a "password" string');
    await changePassword(params.feed, req.headers.get("x-feed-password") ?? "", body.data.password, clientIp(req.headers));
    return { status: 204, body: undefined };
  }),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/feeds/{feed}/password`,
    operationId: "removeFeedPassword",
    summary: "Remove a feed's password",
    description: "Needs the current password in `X-Feed-Password`. The feed stays, open to anyone who knows its name. An open feed answers 409.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam },
    headers: { "X-Feed-Password": CurrentPasswordHeader },
    responses: {
      204: { description: "Removed" },
      400: err("Invalid or reserved feed name"),
      401: UNAUTHORIZED,
      409: err("The feed has no password"),
      429: { ...err("Too many wrong passwords from this client"), headers: RETRY },
    },
    before: passwordAndFeed,
  }).handle(async ({ req, params }) => {
    await removePassword(params.feed, req.headers.get("x-feed-password") ?? "", clientIp(req.headers));
    return { status: 204, body: undefined };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/read/{readId}`,
    operationId: "getReadFeed",
    summary: "Get a feed's title and description by its read id",
    description:
      "Public, even on an instance with a password, and never reveals the feed's name. " +
      "An unknown read id has an empty title and description, so read ids can't be probed.",
    tags: ["Read"],
    params: { readId: ReadIdParam },
    responses: {
      200: { description: "The feed's public settings", schema: ReadFeedJson },
      404: err("Malformed read id"),
    },
  }).handle(async ({ params }) => {
    if (!READ_ID_RE.test(params.readId)) throw new NotFoundError("malformed read id");
    const feed = await feedForReadId(params.readId);
    return { status: 200, body: feed ? await getSettings(feed) : { title: "", description: "" } };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/read/{readId}/notes`,
    operationId: "listReadNotes",
    summary: "List a feed's notes by its read id",
    description:
      "Public, even on an instance with a password, and never reveals the feed's name. " +
      "An unknown read id is an empty list, so read ids can't be probed. The same notes as the read link's RSS.",
    tags: ["Read"],
    params: { readId: ReadIdParam },
    query: PageQuery,
    responses: {
      200: { description: "A page of notes", schema: NoteList },
      400: err("A bad `limit` / `before`"),
      404: err("Malformed read id"),
    },
  }).handle(async ({ req, params, query }) => {
    if (!READ_ID_RE.test(params.readId)) throw new NotFoundError("malformed read id");
    const feed = await feedForReadId(params.readId);
    const notes = (l: number, b?: string) => (feed ? listNotes(feed, l, b) : Promise.resolve([]));
    return page(notes, query, publicUrl(req.headers) + readPath(params.readId));
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/read/{readId}/notes/{id}`,
    operationId: "getReadNote",
    summary: "Get one note by its feed's read id",
    description: "Public, like the read link.",
    tags: ["Read"],
    params: { readId: ReadIdParam, id: NoteIdParam },
    responses: {
      200: { description: "The note", schema: NoteJson },
      404: err("No such note, or a malformed or unknown read id"),
    },
  }).handle(async ({ req, params }) => {
    const feed = await feedForReadId(params.readId);
    const note = feed ? await getNote(feed, params.id) : null;
    if (!note) throw new NotFoundError("no such note");
    return { status: 200, body: noteJson(note, publicUrl(req.headers) + readPath(params.readId)) };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/openapi.json`,
    operationId: "getOpenApi",
    summary: "This API's OpenAPI document",
    description: "Generated from the server's route table, with `servers` set to this instance's URL.",
    tags: ["Meta"],
    params: {},
    responses: { 200: { description: "OpenAPI 3.1", schema: z.record(z.string(), z.unknown()) } },
  }).handle(async ({ req }) => ({ status: 200, body: openApiDocument(publicUrl(req.headers)) })),
];

export const dispatch = createDispatcher(OPS, API_PREFIX);

// --- The OpenAPI document. ---

type Json = Record<string, unknown>;
const URI = (id: string) => `#/components/schemas/${id}`;

// A schema as OpenAPI wants it: a $ref for a component, else inline JSON Schema (params and plain
// strings only, which contain no components).
function jsonSchema(schema: z.ZodType, io: "input" | "output" = "output"): Json {
  const id = (z.globalRegistry.get(schema) as { id?: string } | undefined)?.id;
  if (id) return { $ref: URI(id) };
  const json = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Json;
  delete json.$schema;
  return json;
}

export function openApiDocument(serverUrl: string): Json {
  const registry = z.registry<{ id: string }>();
  for (const c of COMPONENTS) registry.add(c, { id: (z.globalRegistry.get(c) as { id: string }).id });
  const { schemas } = z.toJSONSchema(registry, { uri: URI }) as { schemas: Record<string, Json> };
  for (const s of Object.values(schemas)) {
    delete s.$schema;
    delete s.$id;
  }

  const paths: Record<string, Json> = {};
  for (const entry of OPS) {
    const parameters = [
      ...Object.entries(entry.params).map(([name, s]) => {
        const { description, ...schema } = jsonSchema(s);
        return { name, in: "path", required: true, description, schema };
      }),
      ...Object.entries(entry.headers ?? {}).map(([name, s]) => {
        const { description, ...schema } = jsonSchema(s);
        return { name, in: "header", required: false, description, schema };
      }),
      ...Object.entries(entry.query?.shape ?? {}).map(([name, s]) => {
        const field = s as z.ZodType;
        const { description, ...schema } = jsonSchema(field, "input");
        return { name, in: "query", required: !field.safeParse(undefined).success, description, schema };
      }),
    ];
    const responses = Object.fromEntries(
      Object.entries(entry.responses as Record<number, ResponseSpec>).map(([status, r]) => [
        status,
        {
          description: r.description,
          ...(r.headers && {
            headers: Object.fromEntries(Object.entries(r.headers).map(([h, d]) => [h, { description: d.description, schema: { type: d.type } }])),
          }),
          ...(r.schema && { content: { "application/json": { schema: jsonSchema(r.schema) } } }),
        },
      ]),
    );
    paths[entry.path] = {
      ...paths[entry.path],
      [entry.method.toLowerCase()]: {
        operationId: entry.operationId,
        summary: entry.summary,
        ...(entry.description && { description: entry.description }),
        tags: entry.tags,
        // Optional with a password: an instance without one needs nothing. Without: explicitly public.
        security: entry.password ? [{}, { password: [] }] : [],
        ...(parameters.length && { parameters }),
        ...(entry.body && {
          requestBody: {
            required: true,
            content: Object.fromEntries(Object.entries(entry.body).map(([type, s]) => [type, { schema: jsonSchema(s, "input") }])),
          },
        }),
        responses,
      },
    };
  }

  return {
    openapi: "3.1.1",
    info: {
      title: `${config.title()} API`,
      version: "1",
      description:
        "Post markdown notes to a feed, read them back. See https://docs.notefeed.me/\n\n" +
        "Every error is JSON, `{\"error\": \"...\", \"code\": \"...\"}`. Besides the responses listed per operation, " +
        "an unknown path under /api/v1 answers 404 (`not_found`) and a method an operation doesn't have answers 405 with `Allow`.",
      license: { name: "AGPL-3.0-only", identifier: "AGPL-3.0-only" },
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: "Feeds", description: "By the feed's name, the write key. Need the instance password when one is set." },
      { name: "Read", description: "By the feed's read id. Public and read-only." },
      { name: "Meta", description: "About the API itself." },
    ],
    paths,
    components: {
      schemas,
      securitySchemes: {
        password: { type: "http", scheme: "bearer", description: "The instance password (NOTEFEED_PASSWORD), when one is set" },
      },
    },
  };
}
