// POST /<feed>, also /api/v1/feeds/<feed>/notes (proxy.ts rewrites the first to the second): the only way
// to post a note, for scripts, the client packages and the web UI's compose box alike.
import { AuthError, InvalidBodyError, NoteTooLargeError, NotefeedError, RateLimitedError, UnsupportedTypeError } from "../errors";
import { readId } from "../feeds";
import { clientIp } from "../limits";
import { MAX_BYTES } from "../notes";
import { postNote } from "../posting";
import { feedPath, publicUrl, rssPath } from "../urls";
import { errorResponse } from "./errors";
import { authorize, mediaType, parseForm, readCapped, seeOther, wantsHtml } from "./request";

// curl --data-binary sends x-www-form-urlencoded by default; treat it (and no type) as raw markdown.
const TEXT_TYPES = ["", "text/markdown", "text/plain", "application/x-www-form-urlencoded"];

// A plain form post from the web UI without JavaScript: back to the feed page, which shows the outcome.
function formRedirect(feed: string, e: unknown): Response {
  if (e instanceof AuthError) return seeOther(`/login?next=${encodeURIComponent(feedPath(feed))}`);
  if (!(e instanceof NotefeedError)) return errorResponse(e);
  const retry = e instanceof RateLimitedError ? `&retry=${e.retryAfter}` : "";
  return seeOther(`${feedPath(feed)}?error=${e.code}${retry}`);
}

// The note's markdown from a raw text body, JSON {markdown}, or a form's `markdown` field.
// The 100 KB cap counts the whole body, so a form's own framing takes a few bytes of it.
async function readMarkdown(req: Request): Promise<string> {
  const type = mediaType(req.headers);
  const isJson = type === "application/json";
  const isForm = type === "multipart/form-data";
  if (!isJson && !isForm && !TEXT_TYPES.includes(type)) throw new UnsupportedTypeError();

  const bytes = await readCapped(req, MAX_BYTES);
  if (!bytes) throw new NoteTooLargeError();

  if (isForm) {
    const field = await parseForm(bytes, req.headers).then(
      (f) => f.get("markdown"),
      () => null,
    );
    if (typeof field !== "string") throw new InvalidBodyError('form needs a "markdown" field');
    return field;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new InvalidBodyError("body must be UTF-8");
  }
  if (!isJson) return text;

  let markdown: unknown;
  try {
    markdown = JSON.parse(text).markdown;
  } catch {
    throw new InvalidBodyError("invalid JSON");
  }
  if (typeof markdown !== "string") throw new InvalidBodyError('JSON needs a "markdown" string');
  return markdown;
}

export type Created = { id: string; url: string; feed_url: string; read_url: string };

export async function postNoteRoute(req: Request, feed: string): Promise<Response> {
  const h = req.headers;
  try {
    const ip = clientIp(h);
    // Before anything touches the disk: a locked instance must not create the feed directory.
    authorize(h, ip);
    const note = await postNote(feed, ip, () => readMarkdown(req));
    if (wantsHtml(h)) return seeOther(`${feedPath(feed)}?posted=${note.id}`);
    const base = publicUrl(h);
    const created: Created = {
      id: note.id,
      url: `${base}${feedPath(feed)}/${note.id}`,
      feed_url: base + feedPath(feed),
      read_url: base + rssPath(readId(feed)),
    };
    return Response.json(created, { status: 201 });
  } catch (e) {
    return wantsHtml(h) ? formRedirect(feed, e) : errorResponse(e);
  }
}
