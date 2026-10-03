// GET /r/<readId>/<file> (next.config.ts rewrites a name with an extension here; note ids have none): a file of the feed, public like the read
// link (no password, even on a locked instance; proxy.ts skips /r/). Every file is served except dot files (the feed's own files and the
// notes' sidecars). The type comes from the extension and nothing else, whatever follows the header; what is not an image or text is a download.
import { readFeedFile } from "../data/notes";
import { feedForReadId } from "../feeds";
import { IMAGE_EXTS, contentTypeOf } from "../images";

const NAME_RE = /^[A-Za-z0-9_-]{1,128}\.([A-Za-z0-9]{1,16})$/;

export async function fileRoute(readId: string, file: string): Promise<Response> {
  const feed = await feedForReadId(readId);
  const ext = NAME_RE.exec(file)?.[1];
  const bytes = feed && ext ? await readFeedFile(feed, file) : null;
  if (!bytes || !ext) return new Response("not found", { status: 404 });
  const image = (IMAGE_EXTS as string[]).includes(ext);
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": contentTypeOf(ext),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": image ? "public, max-age=31536000, immutable" : "no-cache", // a note's file can be edited
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ...(!image && ext !== "md" && { "Content-Disposition": "attachment" }),
    },
  });
}
