// POST /api/v1/feeds/<feed>/notes, also POST /<feed> (proxy.ts rewrites it): the only way to post a
// note, for scripts, the client packages and the web UI's compose box alike.
import { decodeHeaderValue } from "../../shared/headers";
import { config } from "../config";
import { ImageTooLargeError, InvalidBodyError, NoteTooLargeError, UnsupportedTypeError } from "../errors";
import { cookieValue } from "../feedlock";
import { clientIp } from "../limits";
import { MAX_BYTES, type NoteEdit } from "../notes";
import { postNote, type PostInput } from "../posting";
import { parseMediaType } from "../note/types";
import { tagsFromHeader } from "../tags";
import { feedPath, imagePath, publicUrl, rssPath } from "../urls";
import { feedCookies } from "./feedsession";
import { authorize, feedAccess, mediaType, parseForm, readCapped, sameOrigin, sender } from "./request";
import { type Created, EditJson } from "./schemas";

// curl --data-binary sends x-www-form-urlencoded by default; treat it (and no type) as raw markdown.
const TEXT_TYPES = ["", "text/markdown", "text/plain", "application/x-www-form-urlencoded"];

// What the POST answers: the created note.
type PostReply = { status: 201; body: Created; headers?: HeadersInit };

// What a post carries: the body is the file, `Content-Type` says which type (exactly one the registry accepts: no guessing, no lenient
// defaults), and everything else is a header: X-Note-Title, -Tags, -Alt, -Name; X-Feed-Password and X-Read-Id for the post that creates
// the feed. The type decides the size limit (100 KB of markdown, NOTEFEED_MAX_IMAGE_BYTES for an image) before the body is read.
export async function readPost(req: Request): Promise<PostInput> {
  const parsed = parseMediaType(req.headers.get("content-type"));
  if (!parsed) throw new UnsupportedTypeError();
  const image = parsed.type.name === "image";
  const body = await readCapped(req, image ? config.maxImageBytes() : MAX_BYTES);
  if (!body) throw image ? new ImageTooLargeError() : new NoteTooLargeError();
  const header = (name: string) => decodeHeaderValue(req.headers.get(name) ?? "").trim() || undefined; // an empty header is none
  return {
    body,
    mediaType: parsed.mediaType,
    title: header("x-note-title"),
    alt: header("x-note-alt"),
    name: fileName(req.headers.get("x-note-name")),
    tags: tagsFromHeader(req.headers.get("x-note-tags")),
    readId: header("x-read-id"),
  };
}

const fileName = (v: string | null) => decodeHeaderValue(v ?? "").replace(/[\x00-\x1f\x7f/\\]/g, "").trim().slice(0, 200) || undefined;

// What an edit carries: markdown, a title, an alt text; at least one (updateNote checks). A raw text body is the markdown.
export async function readEdit(req: Request): Promise<NoteEdit> {
  const type = mediaType(req.headers);
  const isJson = type === "application/json";
  const isForm = type === "multipart/form-data";
  if (!isJson && !isForm && !TEXT_TYPES.includes(type)) throw new UnsupportedTypeError();
  const bytes = await readCapped(req, MAX_BYTES);
  if (!bytes) throw new NoteTooLargeError();
  if (isForm) {
    const data = await parseForm(bytes, req.headers).catch(() => null);
    if (!data) throw new InvalidBodyError("invalid form");
    const text = (k: string) => (typeof data.get(k) === "string" ? (data.get(k) as string) : undefined);
    return { markdown: text("markdown"), title: text("title"), alt: text("alt") };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new InvalidBodyError("body must be UTF-8");
  }
  if (!isJson) return { markdown: text };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InvalidBodyError("invalid JSON");
  }
  const parsed = EditJson.safeParse(json);
  if (!parsed.success) throw new InvalidBodyError('JSON needs "markdown", "title" or "alt" strings');
  return parsed.data;
}

// The postNote entry's handler (backend/http/api.ts). Refusals are thrown as domain errors.
export async function handlePostNote(req: Request, feed: string): Promise<PostReply> {
  const h = req.headers;
  const ip = clientIp(h);
  // Before anything touches the disk: a locked instance must not create the feed directory.
  authorize(h, ip);
  const { note, created, readId } = await postNote(feed, ip, () => readPost(req), feedAccess(h, feed), sender(h));
  // Only the post that created a protected feed gets the cookie: that browser chose the password, so it
  // stays unlocked without asking again. Any other post either came with the cookie or is a script.
  const value = created && sameOrigin(h) ? await cookieValue(feed) : null;
  const base = publicUrl(h);
  return {
    status: 201,
    body: {
      id: note.id,
      url: `${base}${feedPath(feed)}/${note.id}`,
      feed_url: base + feedPath(feed),
      read_url: readId && base + rssPath(readId),
      file: note.file,
      file_url: readId && base + imagePath(readId, note.file),
    },
    headers: value === null ? undefined : feedCookies(h, feed, value),
  };
}
