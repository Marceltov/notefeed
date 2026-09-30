// POST /<feed>: the body of the notes route, testable without Next's routing.
import { bearerAttempt } from "./auth";
import { checkFeed, listFeeds, readId } from "./feeds";
import { clientIp, rateLimit } from "./limits";
import { EmptyNoteError, MAX_BYTES, NoteTooLargeError, countNotes, createNote, feedExists } from "./notes";
import { publicUrl } from "./url";

// curl --data-binary sends x-www-form-urlencoded by default; treat it (and no type) as raw markdown.
const TEXT_TYPES = ["", "text/markdown", "text/plain", "application/x-www-form-urlencoded"];

const error = (status: number, message: string) => Response.json({ error: message }, { status });

// Reads at most MAX_BYTES; null (and the stream cancelled) as soon as the body is larger.
// Content-Length can be absent (chunked) or wrong, so it is never trusted for the cap.
async function readCapped(req: Request): Promise<Uint8Array | null> {
  const out = new Uint8Array(MAX_BYTES);
  let size = 0;
  if (!req.body) return out.subarray(0, 0);
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out.subarray(0, size);
    if (size + value.byteLength > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    out.set(value, size);
    size += value.byteLength;
  }
}

export type Limited = { status: 429 | 507; error: string; retryAfter?: number };

// Unset, invalid or below 1: no cap.
const cap = (name: string) => Math.max(0, Number(process.env[name]) || 0);

// Rate limit and optional caps, shared with the compose box's server action. null → go ahead.
export async function checkLimits(feed: string, headers: Headers): Promise<Limited | null> {
  const wait = rateLimit(clientIp(headers));
  if (wait !== null) return { status: 429, error: "rate limit exceeded", retryAfter: wait };

  // ponytail: caps are checked, not locked; concurrent posts can overshoot by a few.
  const maxFeeds = cap("NOTEFEED_MAX_FEEDS");
  const maxNotes = cap("NOTEFEED_MAX_NOTES_PER_FEED");
  const exists = maxFeeds || maxNotes ? await feedExists(feed) : true;
  if (maxFeeds && !exists && (await listFeeds()).length >= maxFeeds) return { status: 507, error: "feed limit reached" };
  if (maxNotes && exists && (await countNotes(feed)) >= maxNotes) return { status: 507, error: "note limit reached" };
  return null;
}

export async function handlePost(req: Request, feed: string): Promise<Response> {
  // Before anything touches the disk: a locked instance must not create the feed directory.
  const auth = bearerAttempt(req.headers.get("authorization"), clientIp(req.headers));
  if (typeof auth === "number") return Response.json({ error: "too many attempts" }, { status: 429, headers: { "Retry-After": String(auth) } });
  if (auth === "wrong") return error(401, "missing or wrong password");
  const bad = checkFeed(feed);
  if (bad) return error(400, bad === "reserved" ? "feed name is reserved" : "invalid feed name");

  const limited = await checkLimits(feed, req.headers);
  if (limited) {
    const { status, error, retryAfter } = limited;
    return Response.json({ error }, { status, headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined });
  }

  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const isJson = type === "application/json";
  if (!isJson && !TEXT_TYPES.includes(type)) return error(415, "send text/markdown, text/plain or application/json");

  if (Number(req.headers.get("content-length")) > MAX_BYTES) return error(413, "note exceeds 100 KB");
  const bytes = await readCapped(req);
  if (!bytes) return error(413, "note exceeds 100 KB");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return error(400, "body must be UTF-8");
  }

  let markdown = text;
  if (isJson) {
    try {
      markdown = JSON.parse(text).markdown;
    } catch {
      return error(400, "invalid JSON");
    }
    if (typeof markdown !== "string") return error(400, 'JSON needs a "markdown" string');
  }

  try {
    const note = await createNote(feed, markdown);
    const base = publicUrl(req.headers);
    return Response.json(
      {
        id: note.id,
        url: `${base}/${feed}/${note.id}`,
        feed_url: `${base}/${feed}`,
        read_url: `${base}/r/${readId(feed)}/feed.xml`,
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof EmptyNoteError) return error(400, "note is empty");
    if (e instanceof NoteTooLargeError) return error(413, "note exceeds 100 KB");
    console.error("createNote failed", e);
    return error(500, "write failed");
  }
}
