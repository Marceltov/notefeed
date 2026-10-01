// POST /api/v1/feeds/<feed>/notes, also POST /<feed> (proxy.ts rewrites it): the only way to post a
// note, for scripts, the client packages and the web UI's compose box alike.
import { AuthError, InvalidBodyError, NoteTooLargeError, NotefeedError, RateLimitedError, UnsupportedTypeError } from "../errors";
import { readId } from "../feeds";
import { clientIp } from "../limits";
import { MAX_BYTES } from "../notes";
import { postNote } from "../posting";
import { feedPath, publicUrl, rssPath } from "../urls";
import { authorize, mediaType, parseForm, readCapped, wantsHtml } from "./request";
import { type Created, PostForm, PostJson } from "./schemas";

// curl --data-binary sends x-www-form-urlencoded by default; treat it (and no type) as raw markdown.
const TEXT_TYPES = ["", "text/markdown", "text/plain", "application/x-www-form-urlencoded"];

// What the POST answers: the created note, or (to a browser form) a redirect.
type PostReply = { status: 201; body: Created } | { status: 303; body: undefined; headers: { Location: string } };
const redirect = (location: string): PostReply => ({ status: 303, body: undefined, headers: { Location: location } });

// A plain form post from the web UI without JavaScript: back to the feed page, which shows the outcome.
function formRedirect(feed: string, e: unknown): PostReply {
  if (e instanceof AuthError) return redirect(`/login?next=${encodeURIComponent(feedPath(feed))}`);
  if (!(e instanceof NotefeedError)) throw e;
  const retry = e instanceof RateLimitedError ? `&retry=${e.retryAfter}` : "";
  return redirect(`${feedPath(feed)}?error=${e.code}${retry}`);
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
    const form = await parseForm(bytes, req.headers).then(Object.fromEntries, () => null);
    const parsed = PostForm.safeParse(form);
    if (!parsed.success) throw new InvalidBodyError('form needs a "markdown" field');
    return parsed.data.markdown;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new InvalidBodyError("body must be UTF-8");
  }
  if (!isJson) return text;

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InvalidBodyError("invalid JSON");
  }
  const parsed = PostJson.safeParse(json);
  if (!parsed.success) throw new InvalidBodyError('JSON needs a "markdown" string');
  return parsed.data.markdown;
}

// The postNote entry's handler (backend/http/api.ts). Refusals are thrown as domain errors, except to
// a browser form, which always gets a redirect back to the page.
export async function handlePostNote(req: Request, feed: string): Promise<PostReply> {
  const h = req.headers;
  try {
    const ip = clientIp(h);
    // Before anything touches the disk: a locked instance must not create the feed directory.
    authorize(h, ip);
    const note = await postNote(feed, ip, () => readMarkdown(req));
    if (wantsHtml(h)) return redirect(`${feedPath(feed)}?posted=${note.id}`);
    const base = publicUrl(h);
    return {
      status: 201,
      body: {
        id: note.id,
        url: `${base}${feedPath(feed)}/${note.id}`,
        feed_url: base + feedPath(feed),
        read_url: base + rssPath(readId(feed)),
      },
    };
  } catch (e) {
    if (wantsHtml(h)) return formRedirect(feed, e);
    throw e;
  }
}
