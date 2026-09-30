// POST /<feed>: the body of the notes route, testable without Next's routing.
import { bearerOk } from "./auth";
import { checkFeed, readId } from "./feeds";
import { EmptyNoteError, MAX_BYTES, NoteTooLargeError, createNote } from "./notes";
import { publicUrl } from "./url";

// curl --data-binary sends x-www-form-urlencoded by default; treat it (and no type) as raw markdown.
const TEXT_TYPES = ["", "text/markdown", "text/plain", "application/x-www-form-urlencoded"];

const error = (status: number, message: string) => Response.json({ error: message }, { status });

export async function handlePost(req: Request, feed: string): Promise<Response> {
  // Before anything touches the disk: a locked instance must not create the feed directory.
  if (!bearerOk(req.headers.get("authorization"))) return error(401, "missing or wrong password");
  const bad = checkFeed(feed);
  if (bad) return error(400, bad === "reserved" ? "feed name is reserved" : "invalid feed name");

  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const isJson = type === "application/json";
  if (!isJson && !TEXT_TYPES.includes(type)) return error(415, "send text/markdown, text/plain or application/json");

  if (Number(req.headers.get("content-length")) > MAX_BYTES) return error(413, "note exceeds 100 KB");
  // ponytail: reads the whole body before the size check when there's no Content-Length; on an open instance
  // anyone can send 100 KB+ bodies. Stream with a byte cap if that becomes a problem.
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return error(413, "note exceeds 100 KB");
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
