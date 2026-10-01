// POST /<feed> (proxy.ts rewrites it to /api/feeds/<feed>/notes): the only way to post a note, for
// scripts, the client packages and the web UI's compose box alike.
import { SESSION_COOKIE, checkBearer, locked, sessionOk } from "../auth";
import {
  AuthError,
  EmptyNoteError,
  InvalidBodyError,
  InvalidFeedError,
  LimitReachedError,
  NoteTooLargeError,
  NotefeedError,
  RateLimitedError,
  ReservedFeedError,
  UnsupportedTypeError,
} from "../errors";
import { readId } from "../feeds";
import { clientIp } from "../limits";
import { MAX_BYTES } from "../notes";
import { postNote } from "../posting";
import { feedPath, publicUrl, rssPath } from "../urls";
import { cookie, mediaType, parseForm, readCapped, sameOrigin, seeOther, wantsHtml } from "./request";

// curl --data-binary sends x-www-form-urlencoded by default; treat it (and no type) as raw markdown.
const TEXT_TYPES = ["", "text/markdown", "text/plain", "application/x-www-form-urlencoded"];

const STATUS: [new (...args: never[]) => Error, number][] = [
  [InvalidFeedError, 400],
  [ReservedFeedError, 400],
  [EmptyNoteError, 400],
  [InvalidBodyError, 400],
  [AuthError, 401],
  [NoteTooLargeError, 413],
  [UnsupportedTypeError, 415],
  [RateLimitedError, 429], // and TooManyAttemptsError
  [LimitReachedError, 507],
];

function errorResponse(e: unknown): Response {
  const status = STATUS.find(([cls]) => e instanceof cls)?.[1];
  if (!status || !(e instanceof NotefeedError)) {
    console.error("posting a note failed", e);
    return Response.json({ error: "write failed" }, { status: 500 });
  }
  const headers = e instanceof RateLimitedError ? { "Retry-After": String(e.retryAfter) } : undefined;
  return Response.json({ error: e.message, code: e.code }, { status, headers });
}

// A plain form post from the web UI without JavaScript: back to the feed page, which shows the outcome.
function formRedirect(feed: string, e: unknown): Response {
  if (e instanceof AuthError) return seeOther(`/login?next=${encodeURIComponent(feedPath(feed))}`);
  if (!(e instanceof NotefeedError)) return errorResponse(e);
  const retry = e instanceof RateLimitedError ? `&retry=${e.retryAfter}` : "";
  return seeOther(`${feedPath(feed)}?error=${e.code}${retry}`);
}

// Scripts send the bearer password. The compose box sends the session cookie instead, accepted only
// from this instance's own pages: a cross-site form would carry no cookie (SameSite=Lax), and the
// Origin check covers browsers that would.
function authorize(h: Headers, ip: string): void {
  if (!locked()) return;
  if (!h.has("authorization") && sameOrigin(h) && sessionOk(cookie(h, SESSION_COOKIE))) return;
  checkBearer(h.get("authorization"), ip);
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

export async function postNoteRoute(req: Request, feed: string): Promise<Response> {
  const h = req.headers;
  try {
    const ip = clientIp(h);
    // Before anything touches the disk: a locked instance must not create the feed directory.
    authorize(h, ip);
    const note = await postNote(feed, ip, () => readMarkdown(req));
    if (wantsHtml(h)) return seeOther(`${feedPath(feed)}?posted=${note.id}`);
    const base = publicUrl(h);
    return Response.json(
      {
        id: note.id,
        url: `${base}${feedPath(feed)}/${note.id}`,
        feed_url: base + feedPath(feed),
        read_url: base + rssPath(readId(feed)),
      },
      { status: 201 },
    );
  } catch (e) {
    return wantsHtml(h) ? formRedirect(feed, e) : errorResponse(e);
  }
}
