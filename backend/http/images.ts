// GET /r/<readId>/<file> (next.config.ts rewrites a name with an extension here; note ids have none): an uploaded image, public like the read link (no password, even on a locked
// instance; proxy.ts skips /r/). Served as its extension's type and nothing else, whatever follows the header.
import { feedForReadId } from "../feeds";
import { contentTypeOf } from "../images";
import { readNote } from "../data/notes";

// ponytail: Task 4 turns this into the route for every non-dot file; until then it serves the image notes.
export async function imageRoute(readId: string, file: string): Promise<Response> {
  const feed = await feedForReadId(readId);
  const m = /^([A-Za-z0-9_-]{1,128})\.(png|jpg|gif|webp)$/.exec(file);
  const note = feed && m && (await readNote(feed, m[1]));
  if (!note || note.ext !== m[2]) return new Response("not found", { status: 404 });
  return new Response(note.content as BodyInit, {
    headers: {
      "Content-Type": contentTypeOf(note.ext),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
