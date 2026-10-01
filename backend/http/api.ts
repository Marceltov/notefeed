// The public REST API, /api/v1. This table is the single source: apiRoute() dispatches requests
// through it, openApiDocument() generates the OpenAPI 3.1 spec from it, and the tests check every
// response against the schema its entry declares. A route can't exist without being in the spec.
import * as z from "zod";
import { ERROR_CODES } from "../../shared/errors";
import { config } from "../config";
import { InvalidRequestError, NotFoundError } from "../errors";
import { FEED_RE, READ_ID_RE, assertFeed, feedForReadId } from "../feeds";
import { clientIp } from "../limits";
import { MAX_BYTES, getNote, listNotes, type Note } from "../notes";
import { feedPath, publicUrl, readPath } from "../urls";
import { errorResponse } from "./errors";
import { postNoteRoute } from "./notes";
import { authorize } from "./request";

export const API_PREFIX = "/api/v1";
const MAX_LIMIT = 100;

// --- Schemas: named ones become components; the handlers build their bodies with these types. ---

const NOTE_ID = /^\d{8}T\d{6}Z-[a-z0-9-]+$/;

const NoteJson = z
  .object({
    id: z.string().regex(NOTE_ID).describe("UTC time to the second plus a slug of the title"),
    title: z.string().describe("The first heading, or the first non-empty line; may be empty"),
    markdown: z.string().describe("The note, byte-for-byte as posted"),
    created_at: z.iso.datetime().describe("When the note was posted (UTC)"),
    url: z.url().describe("The note's page in the web UI"),
  })
  .meta({ id: "Note" });
type NoteJson = z.infer<typeof NoteJson>;

const NoteList = z
  .object({
    notes: z.array(NoteJson).describe("Newest first"),
    next: z.string().nullable().describe("Pass as `before` for the next (older) page; null on the last page"),
  })
  .meta({ id: "NoteList" });

const Created = z
  .object({
    id: z.string().regex(NOTE_ID),
    url: z.url().describe("The note's page in the web UI"),
    feed_url: z.url().describe("The feed's page in the web UI"),
    read_url: z.url().describe("The feed's read-only RSS link, safe to share"),
  })
  .meta({ id: "Created" });

const ErrorJson = z
  .object({
    error: z.string().describe("A short reason, for people"),
    code: z.enum(ERROR_CODES).optional().describe("Stable machine-readable code; absent only on a 500"),
  })
  .meta({ id: "Error" });

const PostJson = z.object({ markdown: z.string() }).meta({ id: "PostJson" });
const PostForm = z.object({ markdown: z.string() }).meta({ id: "PostForm" });

const COMPONENTS = [NoteJson, NoteList, Created, ErrorJson, PostJson, PostForm];

const FeedParam = z.string().regex(FEED_RE).describe("The feed's name. It is the write key: anyone who knows it can post.");
const ReadIdParam = z.string().regex(READ_ID_RE).describe("The feed's read id, from its read link. Read-only; never reveals the name.");
const NoteIdParam = z.string().regex(NOTE_ID).describe("The note's id");

const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50).describe(`Notes per page, 1–${MAX_LIMIT}`),
  before: z.string().regex(NOTE_ID).optional().describe("Only notes older than this id: the previous page's `next`"),
});

// --- The table. ---

type ResponseSpec = { description: string; schema?: z.ZodType; html?: true; headers?: Record<string, string> };
type Op = {
  method: "GET" | "POST";
  path: string; // OpenAPI template, relative to API_PREFIX
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  password?: true; // needs the instance password when one is set
  params: Record<string, z.ZodType>;
  query?: z.ZodObject;
  body?: Record<string, z.ZodType>;
  responses: Record<number, ResponseSpec>;
  handle: (req: Request, params: Record<string, string>, query: Record<string, unknown>) => Promise<Response>;
};

const err = (description: string): ResponseSpec => ({ description, schema: ErrorJson });
const RETRY = { "Retry-After": "Seconds to wait before trying again" };

// Wire form of a note; `base` is the absolute URL its page lives under.
const noteJson = (n: Note, base: string): NoteJson => ({
  id: n.id,
  title: n.title,
  markdown: n.markdown,
  created_at: n.createdAt.toISOString(),
  url: `${base}/${n.id}`,
});

function parseQuery(req: Request, schema: z.ZodObject): Record<string, unknown> {
  const parsed = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) throw new InvalidRequestError(z.prettifyError(parsed.error).replace(/\s+/g, " ").replace(/^✖ /, ""));
  return parsed.data;
}

async function page(notes: (limit: number, before?: string) => Promise<Note[]>, query: Record<string, unknown>, base: string) {
  const limit = query.limit as number;
  const found = await notes(limit + 1, query.before as string | undefined); // one extra: is there a next page?
  const shown = found.slice(0, limit);
  return Response.json({
    notes: shown.map((n) => noteJson(n, base)),
    next: found.length > limit ? shown[shown.length - 1].id : null,
  } satisfies z.infer<typeof NoteList>);
}

const OPS: Op[] = [
  {
    method: "POST",
    path: "/feeds/{feed}/notes",
    operationId: "postNote",
    summary: "Post a note",
    description:
      "Creates the feed with its first note. Also served at `POST /{feed}`, the short form the client packages and curl one-liners use. " +
      `The body is at most ${MAX_BYTES} bytes and must be UTF-8. ` +
      "`application/x-www-form-urlencoded` (what `curl -d` sends) is read as raw markdown, not as form fields.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam },
    body: {
      "text/markdown": z.string(),
      "text/plain": z.string(),
      "application/json": PostJson,
      "multipart/form-data": PostForm,
    },
    responses: {
      201: { description: "Stored", schema: Created },
      303: { description: "Only when the request accepts `text/html` (a browser submitting a form): back to the feed page", html: true },
      400: err("Invalid or reserved feed name; empty note; bad JSON, form or UTF-8"),
      401: err("The instance has a password and it is missing or wrong"),
      413: err(`Body over ${MAX_BYTES} bytes`),
      415: err("Unsupported content type"),
      429: { ...err("Too many posts, or wrong passwords, from this client"), headers: RETRY },
      507: err("NOTEFEED_MAX_FEEDS or NOTEFEED_MAX_NOTES_PER_FEED reached"),
    },
    handle: (req, p) => postNoteRoute(req, p.feed),
  },
  {
    method: "GET",
    path: "/feeds/{feed}/notes",
    operationId: "listNotes",
    summary: "List a feed's notes",
    description: "Newest first. A feed with no notes (or that doesn't exist yet) is an empty list.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam },
    query: PageQuery,
    responses: {
      200: { description: "A page of notes", schema: NoteList },
      400: err("Invalid or reserved feed name, or a bad `limit` / `before`"),
      401: err("The instance has a password and it is missing or wrong"),
      429: { ...err("Too many wrong passwords from this client"), headers: RETRY },
    },
    handle: async (req, p, q) => {
      authorize(req.headers, clientIp(req.headers));
      assertFeed(p.feed);
      return page((l, b) => listNotes(p.feed, l, b), q, publicUrl(req.headers) + feedPath(p.feed));
    },
  },
  {
    method: "GET",
    path: "/feeds/{feed}/notes/{id}",
    operationId: "getNote",
    summary: "Get one note",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam, id: NoteIdParam },
    responses: {
      200: { description: "The note", schema: NoteJson },
      400: err("Invalid or reserved feed name"),
      401: err("The instance has a password and it is missing or wrong"),
      404: err("No such note"),
      429: { ...err("Too many wrong passwords from this client"), headers: RETRY },
    },
    handle: async (req, p) => {
      authorize(req.headers, clientIp(req.headers));
      assertFeed(p.feed);
      const note = await getNote(p.feed, p.id);
      if (!note) throw new NotFoundError("no such note");
      return Response.json(noteJson(note, publicUrl(req.headers) + feedPath(p.feed)));
    },
  },
  {
    method: "GET",
    path: "/read/{readId}/notes",
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
    handle: async (req, p, q) => {
      if (!READ_ID_RE.test(p.readId)) throw new NotFoundError("malformed read id");
      const feed = await feedForReadId(p.readId);
      const notes = (l: number, b?: string) => (feed ? listNotes(feed, l, b) : Promise.resolve([]));
      return page(notes, q, publicUrl(req.headers) + readPath(p.readId));
    },
  },
  {
    method: "GET",
    path: "/read/{readId}/notes/{id}",
    operationId: "getReadNote",
    summary: "Get one note by its feed's read id",
    description: "Public, like the read link.",
    tags: ["Read"],
    params: { readId: ReadIdParam, id: NoteIdParam },
    responses: {
      200: { description: "The note", schema: NoteJson },
      404: err("No such note, or a malformed or unknown read id"),
    },
    handle: async (req, p) => {
      const feed = await feedForReadId(p.readId);
      const note = feed ? await getNote(feed, p.id) : null;
      if (!note) throw new NotFoundError("no such note");
      return Response.json(noteJson(note, publicUrl(req.headers) + readPath(p.readId)));
    },
  },
  {
    method: "GET",
    path: "/openapi.json",
    operationId: "openapi",
    summary: "This API's OpenAPI document",
    tags: ["Meta"],
    params: {},
    responses: { 200: { description: "OpenAPI 3.1, generated from the server's route table" } },
    handle: async (req) => Response.json(openApiDocument(publicUrl(req.headers))),
  },
];

// --- Dispatch. ---

// The operations for a path under API_PREFIX, whatever the method, with its path parameters.
// `segments` are already percent-decoded (Next's catch-all param), so "a%2Fb" is one segment "a/b".
function match(segments: string[]): { ops: Op[]; params: Record<string, string> } | null {
  const ops: Op[] = [];
  let params: Record<string, string> = {};
  for (const op of OPS) {
    const tpl = op.path.split("/").slice(1);
    if (tpl.length !== segments.length) continue;
    const p: Record<string, string> = {};
    if (tpl.every((t, i) => (t.startsWith("{") ? ((p[t.slice(1, -1)] = segments[i]), true) : t === segments[i]))) {
      ops.push(op);
      params = p;
    }
  }
  return ops.length ? { ops, params } : null;
}

export async function apiRoute(req: Request, segments: string[]): Promise<Response> {
  const m = match(segments);
  if (!m) return errorResponse(new NotFoundError("no such endpoint"));
  const op = m.ops.find((o) => o.method === req.method);
  if (!op) {
    const allow = m.ops.map((o) => o.method).join(", ");
    return Response.json({ error: "method not allowed" }, { status: 405, headers: { Allow: allow } });
  }
  try {
    return await op.handle(req, m.params, op.query ? parseQuery(req, op.query) : {});
  } catch (e) {
    return errorResponse(e);
  }
}

// For the contract test: the schema `res` must match, or why it can't.
export function declaredResponse(method: string, segments: string[], status: number): ResponseSpec | string {
  const op = match(segments)?.ops.find((o) => o.method === method);
  if (!op) return `${method} /${segments.join("/")} is not in the API table`;
  return op.responses[status] ?? `${method} ${op.path} doesn't declare a ${status} response`;
}

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
  for (const op of OPS) {
    const parameters = [
      ...Object.entries(op.params).map(([name, s]) => {
        const { description, ...schema } = jsonSchema(s);
        return { name, in: "path", required: true, description, schema };
      }),
      ...Object.entries(op.query?.shape ?? {}).map(([name, s]) => {
        const field = s as z.ZodType;
        const { description, ...schema } = jsonSchema(field, "input");
        return { name, in: "query", required: !field.safeParse(undefined).success, description, schema };
      }),
    ];
    const responses = Object.fromEntries(
      Object.entries(op.responses).map(([status, r]) => [
        status,
        {
          description: r.description,
          ...(r.headers && { headers: Object.fromEntries(Object.entries(r.headers).map(([h, d]) => [h, { description: d, schema: { type: "integer" } }])) }),
          ...(r.html ? { headers: { Location: { description: "Where to go", schema: { type: "string" } } } } : {}),
          ...(r.schema || !r.html ? { content: { "application/json": { schema: r.schema ? jsonSchema(r.schema) : { type: "object" } } } } : {}),
        },
      ]),
    );
    paths[API_PREFIX + op.path] = {
      ...paths[API_PREFIX + op.path],
      [op.method.toLowerCase()]: {
        operationId: op.operationId,
        summary: op.summary,
        ...(op.description && { description: op.description }),
        tags: op.tags,
        // Optional with a password: an instance without one needs nothing. Without: explicitly public.
        security: op.password ? [{}, { password: [] }] : [],
        ...(parameters.length && { parameters }),
        ...(op.body && {
          requestBody: {
            required: true,
            content: Object.fromEntries(Object.entries(op.body).map(([type, s]) => [type, { schema: jsonSchema(s, "input") }])),
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
      description: "Post markdown notes to a feed, read them back. See https://docs.notefeed.me/",
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
