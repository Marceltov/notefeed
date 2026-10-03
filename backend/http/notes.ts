// POST /api/v1/feeds/<feed>/notes, also POST /<feed> (proxy.ts rewrites it): the only way to post a
// note, for scripts, the client packages and the web UI's compose box alike.
import { config } from "../config";
import { AuthError, ImageTooLargeError, InvalidBodyError, NoteTooLargeError, UnsupportedTypeError } from "../errors";
import { cookieValue } from "../feedlock";
import { clientIp } from "../limits";
import { MAX_BYTES, type NoteEdit } from "../notes";
import { postNote, type PostInput } from "../posting";
import { splitTags, tagsFromHeader } from "../tags";
import { feedPath, imagePath, publicUrl, rssPath } from "../urls";
import { feedCookies } from "./feedsession";
import { authorize, errorRedirect, feedAccess, sameOrigin, sender, mediaType, parseForm, readCapped, wantsHtml } from "./request";
import { type Created, EditJson, PostForm, PostJson } from "./schemas";

// curl --data-binary sends x-www-form-urlencoded by default; treat it (and no type) as raw markdown.
const TEXT_TYPES = ["", "text/markdown", "text/plain", "application/x-www-form-urlencoded"];
// A raw body of one of these is the picture itself; the bytes decide whether it is one.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/octet-stream"];

// What the POST answers: the created note, or (to a browser form) a redirect.
type PostReply = { status: 201; body: Created; headers?: HeadersInit } | { status: 303; body: undefined; headers: HeadersInit };
const redirect = (location: string, more: [string, string][] = []): PostReply => ({ status: 303, body: undefined, headers: [["Location", location], ...more] });

// The API's snake_case `read_id` is `readId` inside.
const withReadId = ({ read_id, ...rest }: { markdown: string; password?: string; tags?: string[]; read_id?: string; title?: string; alt?: string }) => ({ ...rest, readId: read_id });

// What a post carries: a note's markdown, or an image, with the optional new-feed password, tags and read id. The
// markdown comes from a raw text body, JSON, or a form's fields; an image from a raw image body or a form's `file`
// part. Tags come from the body; a raw body has none, so it takes the X-Note-Tags header. A raw image's file name
// comes from X-Note-Name. The 100 KB cap counts the whole body of a markdown post, so a form's own framing takes a
// few bytes of it; an image has NOTEFEED_MAX_IMAGE_BYTES.
export async function readPost(req: Request, imageOnly = false): Promise<PostInput> {
  const post = await readBody(req, imageOnly);
  const header = (name: string) => req.headers.get(name)?.trim() || undefined; // an empty header is none
  return { ...post, tags: post.tags ?? tagsFromHeader(req.headers.get("x-note-tags")), title: post.title ?? header("x-note-title"), alt: post.alt ?? header("x-note-alt") };
}

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

const fileName = (v: string | null | undefined) => (v ?? "").replace(/[\x00-\x1f\x7f/\\]/g, "").trim().slice(0, 200) || undefined;

async function readBody(req: Request, imageOnly: boolean): Promise<PostInput> {
  const type = mediaType(req.headers);
  const isJson = type === "application/json";
  const isForm = type === "multipart/form-data";
  const isImage = IMAGE_TYPES.includes(type);
  if (imageOnly && !isImage) throw new UnsupportedTypeError("send a PNG, JPEG, GIF or WebP image");
  if (!isJson && !isForm && !isImage && !TEXT_TYPES.includes(type)) throw new UnsupportedTypeError();

  const bytes = await readCapped(req, isImage || isForm ? config.maxImageBytes() : MAX_BYTES);
  if (!bytes) throw isImage ? new ImageTooLargeError() : new NoteTooLargeError();
  if (isImage) return { image: bytes, name: fileName(req.headers.get("x-note-name")) };

  if (isForm) {
    // A repeated `tags` field is a list (Object.fromEntries would keep only the last), and each value may itself be
    // comma-separated: that is what the compose box's one text field sends without JavaScript.
    const tagsOf = (f: FormData) => f.getAll("tags").flatMap((v) => (typeof v === "string" ? splitTags(v) : [])); // a file part is no tag
    const data = await parseForm(bytes, req.headers).catch(() => null);
    const file = data?.get("file");
    if (data && file instanceof File) {
      if (data.has("markdown")) throw new InvalidBodyError('a form has a "markdown" field or a "file" part, not both');
      const text = (k: string) => (typeof data.get(k) === "string" ? (data.get(k) as string) : undefined);
      return { image: new Uint8Array(await file.arrayBuffer()), name: fileName(file.name), password: text("password"), readId: text("read_id"), title: text("title"), alt: text("alt"), ...(data.has("tags") && { tags: tagsOf(data) }) };
    }
    if (bytes.length > MAX_BYTES) throw new NoteTooLargeError();
    const form = data && { ...Object.fromEntries(data), ...(data.has("tags") && { tags: tagsOf(data) }) };
    const parsed = PostForm.safeParse(form);
    if (!parsed.success) throw new InvalidBodyError('form needs a "markdown" field');
    return withReadId(parsed.data);
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
  const parsed = PostJson.safeParse(json);
  if (!parsed.success) throw new InvalidBodyError('JSON needs a "markdown" string');
  return withReadId(parsed.data);
}

// The postNote entry's handler (backend/http/api.ts). Refusals are thrown as domain errors, except to
// a browser form, which always gets a redirect back to the page.
export async function handlePostNote(req: Request, feed: string, imageOnly = false): Promise<PostReply> {
  const h = req.headers;
  try {
    const ip = clientIp(h);
    // Before anything touches the disk: a locked instance must not create the feed directory.
    try {
      authorize(h, ip);
    } catch (e) {
      // Only the instance login sends a browser to /login; a feed password failure shows the feed's unlock screen.
      if (e instanceof AuthError && wantsHtml(h)) return redirect(`/login?next=${encodeURIComponent(feedPath(feed))}`);
      throw e;
    }
    const { note, created, readId } = await postNote(feed, ip, () => readPost(req, imageOnly), feedAccess(h, feed), sender(h));
    // Only the post that created a protected feed gets the cookie: that browser chose the password, so it
    // stays unlocked without asking again. Any other post either came with the cookie or is a script.
    const value = created && sameOrigin(h) ? await cookieValue(feed) : null;
    const unlocked = value === null ? undefined : feedCookies(h, feed, value);
    if (wantsHtml(h)) return redirect(`${feedPath(feed)}?posted=${note.id}`, unlocked);
    const base = publicUrl(h);
    return {
      status: 201,
      body: {
        id: note.id,
        url: `${base}${feedPath(feed)}/${note.id}`,
        feed_url: base + feedPath(feed),
        read_url: readId && base + rssPath(readId),
        ...(note.kind !== "markdown" && { file: note.file, file_url: readId ? base + imagePath(readId, note.file) : null }),
      },
      headers: unlocked,
    };
  } catch (e) {
    // A plain form post from the web UI without JavaScript goes back to the feed page, which shows the
    // outcome (a wrong feed password shows its unlock screen).
    if (wantsHtml(h)) return { status: 303, body: undefined, headers: errorRedirect(feedPath(feed), e).headers };
    throw e;
  }
}
