// POST /api/v1/feeds/<feed>/notes, also POST /<feed> (proxy.ts rewrites it): the only way to post a
// note, for scripts, the client packages and the web UI's compose box alike.
import { AuthError, InvalidBodyError, NoteTooLargeError, NotefeedError, RateLimitedError, UnsupportedTypeError } from "../errors";
import { readId } from "../feeds";
import { cookieValue } from "../feedlock";
import { clientIp } from "../limits";
import { MAX_BYTES } from "../notes";
import { postNote } from "../posting";
import { feedPath, publicUrl, rssPath } from "../urls";
import { feedCookies } from "./feedsession";
import { authorize, feedAccess, sameOrigin, mediaType, parseForm, readCapped, wantsHtml } from "./request";
import { type Created, PostForm, PostJson } from "./schemas";

// curl --data-binary sends x-www-form-urlencoded by default; treat it (and no type) as raw markdown.
const TEXT_TYPES = ["", "text/markdown", "text/plain", "application/x-www-form-urlencoded"];

// What the POST answers: the created note, or (to a browser form) a redirect.
type PostReply = { status: 201; body: Created; headers?: HeadersInit } | { status: 303; body: undefined; headers: HeadersInit };
const redirect = (location: string, more: [string, string][] = []): PostReply => ({ status: 303, body: undefined, headers: [["Location", location], ...more] });

// A plain form post from the web UI without JavaScript: back to the feed page, which shows the outcome
// (a wrong feed password shows its unlock screen). The instance login is handled by the caller.
function formRedirect(feed: string, e: unknown): PostReply {
  if (!(e instanceof NotefeedError)) throw e;
  const retry = e instanceof RateLimitedError ? `&retry=${e.retryAfter}` : "";
  return redirect(`${feedPath(feed)}?error=${e.code}${retry}`);
}

// The note's markdown (and the optional new-feed password) from a raw text body, JSON, or a form's fields.
// The 100 KB cap counts the whole body, so a form's own framing takes a few bytes of it.
async function readMarkdown(req: Request): Promise<{ markdown: string; password?: string }> {
  const type = mediaType(req.headers);
  const isJson = type === "application/json";
  const isForm = type === "multipart/form-data";
  if (!isJson && !isForm && !TEXT_TYPES.includes(type)) throw new UnsupportedTypeError();

  const bytes = await readCapped(req, MAX_BYTES);
  if (!bytes) throw new NoteTooLargeError();

  if (isForm) {
    const form = await parseForm(bytes, req.headers).then(Object.fromEntries, () => null);
    const parsed = PostForm.safeParse(form);
    if (!parsed.success) throw new InvalidBodyError('form needs a "markdown" field');
    return parsed.data;
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
  return parsed.data;
}

// The postNote entry's handler (backend/http/api.ts). Refusals are thrown as domain errors, except to
// a browser form, which always gets a redirect back to the page.
export async function handlePostNote(req: Request, feed: string): Promise<PostReply> {
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
    const { note, created } = await postNote(feed, ip, () => readMarkdown(req), feedAccess(h, feed));
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
        read_url: base + rssPath(readId(feed)),
      },
      headers: unlocked,
    };
  } catch (e) {
    if (wantsHtml(h)) return formRedirect(feed, e);
    throw e;
  }
}
