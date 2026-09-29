import { bearerOk } from "@/lib/auth";
import { EmptyNoteError, MAX_BYTES, NoteTooLargeError, createNote } from "@/lib/notes";
import { publicUrl } from "@/lib/url";

// curl --data-binary sends x-www-form-urlencoded by default; treat it (and no type) as raw markdown.
const TEXT_TYPES = ["", "text/markdown", "text/plain", "application/x-www-form-urlencoded"];

const error = (status: number, message: string) => Response.json({ error: message }, { status });

export async function POST(req: Request) {
  if (!bearerOk(req.headers.get("authorization"))) return error(401, "missing or wrong bearer token");

  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const isJson = type === "application/json";
  if (!isJson && !TEXT_TYPES.includes(type)) return error(415, "send text/markdown, text/plain or application/json");

  if (Number(req.headers.get("content-length")) > MAX_BYTES) return error(413, "note exceeds 100 KB");
  // ponytail: reads the whole body before the size check when there's no Content-Length; only token holders get here.
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
    const note = await createNote(markdown);
    return Response.json({ id: note.id, url: `${publicUrl(req.headers)}/n/${note.id}` }, { status: 201 });
  } catch (e) {
    if (e instanceof EmptyNoteError) return error(400, "note is empty");
    if (e instanceof NoteTooLargeError) return error(413, "note exceeds 100 KB");
    console.error("createNote failed", e);
    return error(500, "write failed");
  }
}
