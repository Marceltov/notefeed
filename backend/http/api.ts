// The public REST API, /api/v1, defined in code: this table is the single source. `dispatch` serves
// requests through it, and openApiDocument() generates the OpenAPI 3.1 description the clients are
// generated from. Each handler is typed from its own declared responses (see op() in dispatch.ts).
import * as z from "zod";
import { config } from "../config";
import { InvalidBodyError, NotFoundError } from "../errors";
import { changePassword, checkFeedAccess, protectedFeed, removePassword } from "../feedlock";
import { isReadId, assertFeed, feedForReadId, hasFeed, readIdOf } from "../feeds";
import { forReaders, getSettings } from "../feedsettings";
import { clientIp } from "../limits";
import { MAX_BYTES, countNotes, getNote, listNotes, type Note } from "../notes";
import { PASSWORD_RULE } from "../../shared/password";
import { TAG_RULE } from "../tags";
import { API_PREFIX, feedPath, imagePath, publicUrl, readPath, rssPath } from "../urls";
import { MEDIA_TYPES } from "../note/media";
import { createDispatcher, op, type AnyOp, type ResponseSpec } from "./dispatch";
import { MAX_ATTACHMENTS, deleteFeed, deleteNote, editContent, editMeta, editWithPictures, updateFeed } from "../posting";
import { MULTIPART_SLACK, createdOf, handlePostNote, readContent, readMetaPatch, readMultipart } from "./notes";
import { authorize, feedAccess, mediaType, readCapped, sender } from "./request";
import {
  COMPONENTS,
  CurrentPasswordHeader,
  ErrorJson,
  FeedJson,
  FeedParam,
  FeedPasswordHeader,
  FeedSettingsJson,
  FileBody,
  MetaJson,
  MultipartNote,
  NoteAltHeader,
  NoteNameHeader,
  NoteTitleHeader,
  ReadIdHeader,
  NoteIdParam,
  NoteEdited,
  NoteJson,
  NoteList,
  NoteTagsHeader,
  PageQuery,
  PasswordJson,
  Posted,
  ReadFeedJson,
  ReadIdParam,
} from "./schemas";

export { API_PREFIX };

const err = (description: string) => ({ description, schema: ErrorJson }) satisfies ResponseSpec;
const RETRY = { "Retry-After": { description: "Seconds to wait before trying again", type: "integer" } } as const;
const MULTIPART =
  "A markdown note with its pictures is one `multipart/form-data` request: a `text` part (the markdown, a field or a file part; a file part keeps its line breaks, a field's are sent as CRLF), " +
  `\`file\` parts (up to ${MAX_ATTACHMENTS} pictures, each with its file name and image \`Content-Type\`) and \`alt.<file name>\` fields. ` +
  "The pictures are stored first, each as its own note named by its file name, then the text with its references to them (`![](chart.png)`, `[x]: chart.png`, " +
  "as written or percent-decoded) swapped for the stored files; a picture it never refers to is appended as `![](file)`. Everything is checked before the first write, " +
  "and a failed write removes what the request stored: all or nothing. `X-Note-Alt` and `X-Note-Name` are 400. " +
  "The answer has `attachments`, the stored pictures in the order of the `file` parts. ";
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

// Wire form of a note; `base` is the absolute URL its page lives under, `files` the one its files are served under
// (the feed's read link; null while the feed has none).
const noteJson = (n: Note, base: string, files: string | null): NoteJson => ({
  id: n.id,
  type: n.type,
  file: n.file,
  file_url: files && files + n.file,
  size: n.size,
  title: n.title,
  ...(n.content !== undefined && { content: n.content }),
  ...(n.alt !== undefined && { alt: n.alt }),
  ...("name" in n && typeof n.name === "string" && { name: n.name }),
  created_at: n.createdAt.toISOString(),
  url: `${base}/${n.id}`,
  ...(n.sender !== undefined && { sender: n.sender }),
  tags: n.tags,
});

// Where a feed's files are served from (by its name, for the Feeds API), or null while it has no read link.
async function filesOf(feed: string, headers: Headers): Promise<string | null> {
  const readId = await readIdOf(feed);
  return readId && `${publicUrl(headers)}${readPath(readId)}/`;
}

// One page of notes, newest first, and the cursor for the next one.
async function page(notes: (limit: number, before?: string, tag?: string) => Promise<Note[]>, query: z.infer<typeof PageQuery>, base: string, files: string | null) {
  const found = await notes(query.limit + 1, query.before, query.tag); // one extra: is there a next page?
  const shown = found.slice(0, query.limit);
  return {
    status: 200 as const,
    body: { notes: shown.map((n) => noteJson(n, base, files)), next: found.length > query.limit ? shown[shown.length - 1].id : null },
  };
}

// The feed as the Feeds API shows it; the feed must exist. No read link while it has no notes (ADR 0008).
export async function feedJson(feed: string, headers: Headers): Promise<z.infer<typeof FeedJson>> {
  const readId = (await countNotes(feed)) ? await readIdOf(feed) : null;
  const { title, description, image, showSender } = await getSettings(feed);
  return {
    name: feed,
    title,
    description,
    protected: await protectedFeed(feed),
    read_url: readId && publicUrl(headers) + rssPath(readId),
    image_url: readId && image ? publicUrl(headers) + imagePath(readId, image) : null,
    show_sender: showSender,
  };
}

const OPS: AnyOp[] = [
  op({
    method: "POST",
    path: `${API_PREFIX}/feeds/{feed}/notes`,
    operationId: "postNote",
    summary: "Post a note",
    description:
      "The body is the note, a file, and `Content-Type` says which kind: `text/markdown` (UTF-8, at most " +
      `${MAX_BYTES} bytes), or an image, \`image/png\`, \`image/jpeg\`, \`image/gif\` or \`image/webp\` (at most NOTEFEED_MAX_IMAGE_BYTES, default 5 MiB). ` +
      "Nothing is guessed: any other type, or none, is `415`, and so is a body that is not what the type says (an image is recognized by its first bytes; SVG is refused). " +
      "It is stored byte for byte, with no resizing and no metadata stripped (EXIF such as GPS position stays in an image). " +
      "Creates the feed with its first note, optionally protected by its own password (`X-Feed-Password`; " +
      `${PASSWORD_RULE}) and with the read id in \`X-Read-Id\`; both are only used by the post that creates the feed. ` +
      "Posting to a protected feed needs its password. Also served at `POST /{feed}`, the short form curl one-liners use. " +
      "The response names the note's `file` and where it is served, `file_url`, under the feed's read id (public like the read link). " +
      `Metadata goes in headers: \`X-Note-Title\`, \`X-Note-Tags\` (${TAG_RULE}), \`X-Note-Alt\` (images), \`X-Note-Name\` (the original file name). ` +
      MULTIPART +
      "The `text` part is optional: `X-Note-Title` goes on the text note and `X-Note-Tags` on every note; with no `text` part only the pictures are stored, each with the title, and the answer's top level is the first picture. " +
      "A refused multipart post that would have created a protected feed creates nothing.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam },
    headers: {
      "X-Feed-Password": FeedPasswordHeader,
      "X-Read-Id": ReadIdHeader,
      "X-Note-Title": NoteTitleHeader,
      "X-Note-Tags": NoteTagsHeader,
      "X-Note-Alt": NoteAltHeader,
      "X-Note-Name": NoteNameHeader,
    },
    body: { ...Object.fromEntries(MEDIA_TYPES.map((m) => [m.mediaType, FileBody])), "multipart/form-data": MultipartNote },
    responses: {
      201: { description: "Stored: the note, and with a multipart body its pictures", schema: Posted },
      400: err(
        "Invalid or reserved feed name; a blank note; a bad title, alt text or tags; a new password that is not printable ASCII; " +
          `a multipart body with an unexpected part, no \`text\` and no \`file\`, more than ${MAX_ATTACHMENTS} files, a bad or repeated file name, a text sent with pictures that takes too long to read (\`NOTEFEED_PARSE_TIMEOUT_MS\`), or \`X-Note-Alt\` / \`X-Note-Name\``,
      ),
      401: UNAUTHORIZED,
      409: err("A password was sent for a feed that already exists without one: it can't be claimed; or the chosen read id is taken"),
      413: err(`Markdown over ${MAX_BYTES} bytes, or an image over NOTEFEED_MAX_IMAGE_BYTES (each picture of a multipart body too), or a multipart body over ${MAX_BYTES} bytes plus ${MAX_ATTACHMENTS} images plus ${MULTIPART_SLACK / 1024} KiB`),
      415: err("Content-Type missing or not one of the accepted types, or the body (or a multipart body's picture) is not what it declares"),
      429: { ...err("Too many posts, or wrong passwords, from this client"), headers: RETRY },
      507: err("NOTEFEED_MAX_FEEDS, NOTEFEED_MAX_NOTES_PER_FEED or NOTEFEED_MAX_IMAGES_PER_FEED reached"),
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
    return page((l, b, t) => listNotes(params.feed, l, b, t), query, publicUrl(req.headers) + feedPath(params.feed), await filesOf(params.feed, req.headers));
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
    return { status: 200, body: noteJson(note, publicUrl(req.headers) + feedPath(params.feed), await filesOf(params.feed, req.headers)) };
  }),

  op({
    method: "PUT",
    path: `${API_PREFIX}/feeds/{feed}/notes/{id}`,
    operationId: "editNote",
    summary: "Replace a note's content",
    description:
      "The body is the new file, with the same rules as posting: a `Content-Type` that is one of the accepted types, a body that is what it declares. " +
      "A note keeps its type, so the type must be the note's own (`415` otherwise). Id, creation time and metadata stay: " +
      "the title of a markdown note without one set follows the new text. Change the title or alt text with `PATCH`. " +
      "Needs the feed's password if it has one, and counts against the post rate limit. Read links can't edit. " +
      MULTIPART +
      "On a `PUT` the `text` part is required and the note must be a markdown note; the note keeps its own title and tags, `X-Note-Tags` goes on the new pictures.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam, id: NoteIdParam },
    headers: { "X-Feed-Password": FeedPasswordHeader, "X-Note-Tags": NoteTagsHeader },
    body: { ...Object.fromEntries(MEDIA_TYPES.map((m) => [m.mediaType, FileBody])), "multipart/form-data": MultipartNote },
    responses: {
      200: { description: "The note as it is now, and with a multipart body the new pictures", schema: NoteEdited },
      400: err(
        "Invalid or reserved feed name; a blank note; " +
          `a multipart body with an unexpected part, no \`text\`, more than ${MAX_ATTACHMENTS} files, a bad or repeated file name, a text sent with pictures that takes too long to read (\`NOTEFEED_PARSE_TIMEOUT_MS\`), or \`X-Note-Alt\` / \`X-Note-Name\``,
      ),
      401: UNAUTHORIZED,
      404: err("No such note"),
      413: err(`Markdown over ${MAX_BYTES} bytes, or an image over NOTEFEED_MAX_IMAGE_BYTES (each picture of a multipart body too), or a multipart body over ${MAX_BYTES} bytes plus ${MAX_ATTACHMENTS} images plus ${MULTIPART_SLACK / 1024} KiB`),
      415: err("Content-Type missing, not accepted or not the note's own type (a multipart body is for a markdown note), or the body (or a picture) is not what it declares"),
      429: { ...err("Too many posts, edits and deletes, or wrong passwords, from this client"), headers: RETRY },
      507: err("NOTEFEED_MAX_IMAGES_PER_FEED reached"),
    },
    before: passwordAndFeed,
  }).handle(async ({ req, params }) => {
    const h = req.headers;
    const [ip, access] = [clientIp(h), feedAccess(h, params.feed)];
    const base = publicUrl(h) + feedPath(params.feed);
    if (mediaType(h) !== "multipart/form-data") {
      const note = await editContent(params.feed, params.id, ip, () => readContent(req), access);
      return { status: 200, body: noteJson(note, base, await filesOf(params.feed, h)) };
    }
    const { note, pictures } = await editWithPictures(params.feed, params.id, ip, () => readMultipart(req, "edit"), access, sender(h));
    const readId = await readIdOf(params.feed);
    const attachments = pictures.map((p) => createdOf(h, params.feed, readId, p));
    return { status: 200, body: { ...noteJson(note, base, await filesOf(params.feed, h)), attachments } };
  }),

  op({
    method: "PATCH",
    path: `${API_PREFIX}/feeds/{feed}/notes/{id}`,
    operationId: "patchNote",
    summary: "Change a note's title or alt text",
    description:
      "Sets the note's title and/or alt text (alt only for images). An empty string removes one: a markdown note's title follows its text again. " +
      "At least one is needed. Needs the feed's password if it has one, and counts against the post rate limit. Read links can't change notes.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam, id: NoteIdParam },
    headers: { "X-Feed-Password": FeedPasswordHeader },
    body: { "application/json": MetaJson },
    responses: {
      200: { description: "The note as it is now", schema: NoteJson },
      400: err("Invalid or reserved feed name; nothing to change; a bad title or alt text; alt for a note that has none; bad JSON"),
      401: UNAUTHORIZED,
      404: err("No such note"),
      415: err("Content-Type is not application/json"),
      429: { ...err("Too many posts, edits and deletes, or wrong passwords, from this client"), headers: RETRY },
    },
    before: passwordAndFeed,
  }).handle(async ({ req, params }) => {
    const note = await editMeta(params.feed, params.id, clientIp(req.headers), () => readMetaPatch(req), feedAccess(req.headers, params.feed));
    return { status: 200, body: noteJson(note, publicUrl(req.headers) + feedPath(params.feed), await filesOf(params.feed, req.headers)) };
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
    description: "The title and description, the title image, whether the feed is protected, and its read link (null while it has no notes). A feed exists once its first note is posted.",
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
      "`show_sender` (default true) shows who posted each note to readers; omitted leaves it as it is. `read_id` gives the feed another read link (3 to 64 characters: a-z, 0-9, - and _; empty for a random one): the old id is freed and answers like an unknown read id until another feed takes it, and the notes are not edited (a relative image link follows the new id, a full URL does not). A short readable read id is guessable, so protect the feed with a password if that matters. An instance can turn chosen read ids off (NOTEFEED_ALLOW_CUSTOM_IDS=0): then only an empty `read_id` is accepted. `image` is the file name `uploadImage` returned for this feed (title image), empty to remove it, or omitted to leave it as it is; any other value is a 400. " +
      "Needs the feed's password if it has one, and counts against the post rate limit. Only on a feed that exists: it is created by its first note. Read links can't change settings.",
    tags: ["Feeds"],
    password: true,
    params: { feed: FeedParam },
    headers: { "X-Feed-Password": FeedPasswordHeader },
    body: { "application/json": FeedSettingsJson },
    responses: {
      200: { description: "The feed as it is now", schema: FeedJson },
      400: err("Invalid or reserved feed name, bad JSON, a title or description that is too long or has control characters, a malformed read id, a reserved feed's read id, or chosen read ids turned off"),
      401: UNAUTHORIZED,
      404: err("No such feed"),
      409: err("The read id belongs to another feed or is held back for a reserved one"),
      429: { ...err("Too many posts, edits and deletes, or wrong passwords, from this client"), headers: RETRY },
    },
    before: passwordAndFeed,
  }).handle(async ({ req, params }) => {
    const read = async () => {
      const bytes = await readCapped(req, 8192);
      try {
        const j = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes ?? new Uint8Array()));
        // The API's snake_case name; checkSettings reads the stored one.
        return j && typeof j === "object" && !Array.isArray(j) ? { ...j, showSender: j.show_sender, readId: j.read_id } : j;
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
  }).handle(async ({ req, params }) => {
    if (!isReadId(params.readId)) throw new NotFoundError("malformed read id");
    const feed = await feedForReadId(params.readId);
    const { title, description, image } = feed ? await getSettings(feed) : { title: "", description: "", image: "" };
    return { status: 200, body: { title, description, image_url: image ? publicUrl(req.headers) + imagePath(params.readId, image) : null } };
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
    if (!isReadId(params.readId)) throw new NotFoundError("malformed read id");
    const feed = await feedForReadId(params.readId);
    const settings = feed ? await getSettings(feed) : null;
    const notes = async (l: number, b?: string, t?: string) => (feed && settings ? forReaders(await listNotes(feed, l, b, t), settings) : []);
    return page(notes, query, publicUrl(req.headers) + readPath(params.readId), `${publicUrl(req.headers)}${readPath(params.readId)}/`);
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
    const found = feed ? await getNote(feed, params.id) : null;
    if (!feed || !found) throw new NotFoundError("no such note");
    const [note] = forReaders([found], await getSettings(feed));
    return { status: 200, body: noteJson(note, publicUrl(req.headers) + readPath(params.readId), `${publicUrl(req.headers)}${readPath(params.readId)}/`) };
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
