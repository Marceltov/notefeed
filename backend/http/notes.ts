// POST /<feed> (proxy.ts rewrites it to /api/feeds/<feed>/notes): the API for scripts and the clients.
import { checkBearer } from "../auth";
import {
  AuthError,
  EmptyNoteError,
  InvalidBodyError,
  InvalidFeedError,
  LimitReachedError,
  NoteTooLargeError,
  RateLimitedError,
  ReservedFeedError,
  UnsupportedTypeError,
} from "../errors";
import { readId } from "../feeds";
import { clientIp } from "../limits";
import { MAX_BYTES } from "../notes";
import { postNote } from "../posting";
import { feedPath, publicUrl, rssPath } from "../urls";

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
  if (!status) {
    console.error("posting a note failed", e);
    return Response.json({ error: "write failed" }, { status: 500 });
  }
  const headers = e instanceof RateLimitedError ? { "Retry-After": String(e.retryAfter) } : undefined;
  return Response.json({ error: (e as Error).message }, { status, headers });
}

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

// The note's markdown from a raw text or JSON {markdown} body.
async function readMarkdown(req: Request): Promise<string> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const isJson = type === "application/json";
  if (!isJson && !TEXT_TYPES.includes(type)) throw new UnsupportedTypeError();

  if (Number(req.headers.get("content-length")) > MAX_BYTES) throw new NoteTooLargeError();
  const bytes = await readCapped(req);
  if (!bytes) throw new NoteTooLargeError();
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
  try {
    const ip = clientIp(req.headers);
    // Before anything touches the disk: a locked instance must not create the feed directory.
    checkBearer(req.headers.get("authorization"), ip);
    const note = await postNote(feed, ip, () => readMarkdown(req));
    const base = publicUrl(req.headers);
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
    return errorResponse(e);
  }
}
