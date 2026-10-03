// POST /api/v1/feeds/<feed>/notes, also POST /<feed> (proxy.ts rewrites it): the only way to post a
// note, for scripts, the client packages and the web UI's compose box alike.
import { decodeHeaderValue } from "../../shared/headers";
import { config } from "../config";
import { ImageTooLargeError, InvalidBodyError, NoteTooLargeError, UnsupportedTypeError } from "../errors";
import { cookieValue } from "../feedlock";
import { clientIp } from "../limits";
import { MAX_BYTES, type Note } from "../notes";
import { MAX_ATTACHMENTS, postNote, postWithPictures, type Picture, type PostBundle, type PostInput } from "../posting";
import { parseMedia } from "../note/media";
import { parseMediaType } from "../note/types";
import { tagsFromHeader } from "../tags";
import { feedPath, imagePath, publicUrl, rssPath } from "../urls";
import { feedCookies } from "./feedsession";
import { authorize, feedAccess, mediaType, parseForm, readCapped, sameOrigin, sender } from "./request";
import { type Created, MetaJson, type Posted } from "./schemas";

// What the POST answers: the created note (with a multipart post's pictures).
type PostReply = { status: 201; body: Posted; headers?: HeadersInit };

const headerOf = (req: Request) => (name: string) => decodeHeaderValue(req.headers.get(name) ?? "").trim() || undefined; // an empty header is none

// What a post carries: the body is the file, `Content-Type` says which type (exactly one the registry accepts: no guessing, no lenient
// defaults), and everything else is a header: X-Note-Title, -Tags, -Alt, -Name; X-Feed-Password and X-Read-Id for the post that creates
// the feed. The type decides the size limit (100 KB of markdown, NOTEFEED_MAX_IMAGE_BYTES for an image) before the body is read.
export async function readPost(req: Request): Promise<PostInput> {
  const parsed = parseMediaType(req.headers.get("content-type"));
  if (!parsed) throw new UnsupportedTypeError();
  const image = parsed.type.name === "image";
  const body = await readCapped(req, image ? config.maxImageBytes() : MAX_BYTES);
  if (!body) throw image ? new ImageTooLargeError() : new NoteTooLargeError();
  const header = headerOf(req);
  return {
    body,
    mediaType: parsed.mediaType,
    title: header("x-note-title"),
    alt: header("x-note-alt"),
    name: header("x-note-name"), // cleaned where the note is made (cleanName)
    tags: tagsFromHeader(req.headers.get("x-note-tags")),
    readId: header("x-read-id"),
  };
}

// What a multipart body's framing (boundaries, part headers, alt fields) may add to its text and pictures.
export const MULTIPART_SLACK = 64 * 1024;

// A `text` sent as a file part: its bytes as UTF-8, kept as they are (a browser's FormData sends a string field's line breaks as
// CRLF, a file part's bytes untouched). The file name is ignored; a type, when given, must be markdown, or application/octet-stream
// (what curl labels a .md file: the part's name already says it is markdown).
async function textFile(file: File): Promise<string> {
  const typed = file.type && file.type.toLowerCase() !== "application/octet-stream";
  if (typed && parseMedia(file.type)?.mediaType !== "text/markdown") throw new UnsupportedTypeError("send the text part as text/markdown (UTF-8)");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
  } catch {
    throw new InvalidBodyError("the text part is not UTF-8");
  }
}

// A multipart/form-data post or PUT: a `text` part (a field or a file part; at most one; required on a PUT), `file` parts (pictures, each with its file
// name) and `alt.<file name>` fields; anything else is 400. The pictures themselves are checked in postWithPictures. Title, tags
// and the read id are the headers a raw post has; X-Note-Alt and X-Note-Name have their place in the form instead, so they are 400.
export async function readMultipart(req: Request, kind: "edit"): Promise<PostBundle & { text: string }>;
export async function readMultipart(req: Request, kind: "post"): Promise<PostBundle>;
export async function readMultipart(req: Request, kind: "post" | "edit"): Promise<PostBundle> {
  const header = headerOf(req);
  if (header("x-note-alt") || header("x-note-name")) throw new InvalidBodyError("with a multipart body, send alt texts as alt.<file name> fields and the file name with each file");
  const bytes = await readCapped(req, MAX_BYTES + MAX_ATTACHMENTS * config.maxImageBytes() + MULTIPART_SLACK);
  if (!bytes) throw new NoteTooLargeError();
  const form = await parseForm(bytes, req.headers).catch(() => {
    throw new InvalidBodyError("not a valid multipart body");
  });
  let text: string | undefined;
  const pictures: Picture[] = [];
  const alts = new Map<string, string>();
  for (const [key, value] of form.entries()) {
    if (key === "text" && text === undefined) text = typeof value === "string" ? value : await textFile(value);
    else if (key === "file" && typeof value !== "string" && value.name) pictures.push({ name: value.name, body: new Uint8Array(await value.arrayBuffer()), mediaType: value.type });
    else if (key.startsWith("alt.") && typeof value === "string" && !alts.has(key.slice(4))) alts.set(key.slice(4), value.trim());
    else throw new InvalidBodyError(`unexpected part "${key}": send one text field, files with their file names, and alt.<file name> fields`);
  }
  for (const name of alts.keys()) if (!pictures.some((p) => p.name === name)) throw new InvalidBodyError(`alt.${name}: no file of that name`);
  for (const p of pictures) p.alt = alts.get(p.name) || undefined;
  if (kind === "edit" && text === undefined) throw new InvalidBodyError("send the note's new text as a text field");
  return { text, pictures, title: header("x-note-title"), tags: tagsFromHeader(req.headers.get("x-note-tags")), readId: header("x-read-id") };
}

// The answer for one stored note; `readId` is its feed's.
export function createdOf(h: Headers, feed: string, readId: string | null, note: Note): Created {
  const base = publicUrl(h);
  return {
    id: note.id,
    url: `${base}${feedPath(feed)}/${note.id}`,
    feed_url: base + feedPath(feed),
    read_url: readId && base + rssPath(readId),
    file: note.file,
    file_url: readId && base + imagePath(readId, note.file),
  };
}

// The file of a PUT: the same body and Content-Type rules as a post (the note's own type is checked against it later).
export async function readContent(req: Request): Promise<{ body: Uint8Array; mediaType: string }> {
  const { body, mediaType } = await readPost(req);
  return { body, mediaType };
}

// The JSON of a PATCH: a title and/or an alt text.
export async function readMetaPatch(req: Request): Promise<{ title?: string; alt?: string }> {
  if (mediaType(req.headers) !== "application/json") throw new UnsupportedTypeError("send Content-Type: application/json");
  const bytes = await readCapped(req, MAX_BYTES);
  if (!bytes) throw new NoteTooLargeError();
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InvalidBodyError("invalid JSON");
  }
  const parsed = MetaJson.safeParse(json);
  if (!parsed.success) throw new InvalidBodyError('JSON may carry "title" and "alt" strings');
  return parsed.data;
}

// The postNote entry's handler (backend/http/api.ts). Refusals are thrown as domain errors.
export async function handlePostNote(req: Request, feed: string): Promise<PostReply> {
  const h = req.headers;
  const ip = clientIp(h);
  // Before anything touches the disk: a locked instance must not create the feed directory.
  authorize(h, ip);
  const multipart = mediaType(h) === "multipart/form-data";
  const { note, created, readId, pictures } = multipart
    ? await postWithPictures(feed, ip, () => readMultipart(req, "post"), feedAccess(h, feed), sender(h))
    : { ...(await postNote(feed, ip, () => readPost(req), feedAccess(h, feed), sender(h))), pictures: undefined };
  // Only the post that created a protected feed gets the cookie: that browser chose the password, so it
  // stays unlocked without asking again. Any other post either came with the cookie or is a script.
  const value = created && sameOrigin(h) ? await cookieValue(feed) : null;
  return {
    status: 201,
    body: { ...createdOf(h, feed, readId, note), ...(pictures && { attachments: pictures.map((p) => createdOf(h, feed, readId, p)) }) },
    headers: value === null ? undefined : feedCookies(h, feed, value),
  };
}
