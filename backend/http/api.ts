// The public REST API, /api/v1, defined in code: this table is the single source. `dispatch` serves
// requests through it, and openApiDocument() generates the OpenAPI 3.1 description the clients are
// generated from. Each handler is typed from its own declared responses (see op() in dispatch.ts).
import * as z from "zod";
import { config } from "../config";
import { NotFoundError } from "../errors";
import { READ_ID_RE, assertFeed, feedForReadId } from "../feeds";
import { clientIp } from "../limits";
import { MAX_BYTES, getNote, listNotes, type Note } from "../notes";
import { feedPath, publicUrl, readPath } from "../urls";
import { createDispatcher, op, type AnyOp, type ResponseSpec } from "./dispatch";
import { handlePostNote } from "./notes";
import { authorize } from "./request";
import {
  COMPONENTS,
  Created,
  ErrorJson,
  FeedParam,
  NoteIdParam,
  NoteJson,
  NoteList,
  PageQuery,
  PostForm,
  PostJson,
  ReadIdParam,
} from "./schemas";

export const API_PREFIX = "/api/v1";

const err = (description: string) => ({ description, schema: ErrorJson }) satisfies ResponseSpec;
const RETRY = { "Retry-After": { description: "Seconds to wait before trying again", type: "integer" } } as const;
const UNAUTHORIZED = err("The instance has a password and it is missing or wrong");

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

const OPS: AnyOp[] = [
  op({
    method: "POST",
    path: "/api/v1/feeds/{feed}/notes",
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
      303: {
        description:
          "Only when the request accepts `text/html` (a browser submitting a form): back to the feed page with `?posted=<id>` or `?error=<code>`, or to the login page",
        headers: { Location: { description: "Where to go", type: "string" } },
      },
      400: err("Invalid or reserved feed name; empty note; bad JSON, form or UTF-8"),
      401: UNAUTHORIZED,
      413: err(`Body over ${MAX_BYTES} bytes`),
      415: err("Unsupported content type"),
      429: { ...err("Too many posts, or wrong passwords, from this client"), headers: RETRY },
      507: err("NOTEFEED_MAX_FEEDS or NOTEFEED_MAX_NOTES_PER_FEED reached"),
    },
  }).handle(({ req, params }) => handlePostNote(req, params.feed)),

  op({
    method: "GET",
    path: "/api/v1/feeds/{feed}/notes",
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
      401: UNAUTHORIZED,
      429: { ...err("Too many wrong passwords from this client"), headers: RETRY },
    },
  }).handle(async ({ req, params, query }) => {
    authorize(req.headers, clientIp(req.headers));
    assertFeed(params.feed);
    return page((l, b) => listNotes(params.feed, l, b), query, publicUrl(req.headers) + feedPath(params.feed));
  }),

  op({
    method: "GET",
    path: "/api/v1/feeds/{feed}/notes/{id}",
    operationId: "getNote",
    summary: "Get one note",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam, id: NoteIdParam },
    responses: {
      200: { description: "The note", schema: NoteJson },
      400: err("Invalid or reserved feed name"),
      401: UNAUTHORIZED,
      404: err("No such note"),
      429: { ...err("Too many wrong passwords from this client"), headers: RETRY },
    },
  }).handle(async ({ req, params }) => {
    authorize(req.headers, clientIp(req.headers));
    assertFeed(params.feed);
    const note = await getNote(params.feed, params.id);
    if (!note) throw new NotFoundError("no such note");
    return { status: 200, body: noteJson(note, publicUrl(req.headers) + feedPath(params.feed)) };
  }),

  op({
    method: "GET",
    path: "/api/v1/read/{readId}/notes",
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
    path: "/api/v1/read/{readId}/notes/{id}",
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
    path: "/api/v1/openapi.json",
    operationId: "getOpenApi",
    summary: "This API's OpenAPI document",
    description: "Generated from the server's route table, with `servers` set to this instance's URL.",
    tags: ["Meta"],
    params: {},
    responses: { 200: { description: "OpenAPI 3.1", schema: z.record(z.string(), z.unknown()) } },
  }).handle(async ({ req }) => ({ status: 200, body: openApiDocument(publicUrl(req.headers)) })),
];

export const dispatch = createDispatcher(OPS);

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
