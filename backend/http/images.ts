// GET /r/<readId>/<file> (next.config.ts rewrites a name with an extension here; note ids have none): an uploaded image, public like the read link (no password, even on a locked
// instance; proxy.ts skips /r/). Served as its extension's type and nothing else, whatever follows the header.
import { feedForReadId } from "../feeds";
import { loadImage } from "../images";

export async function imageRoute(readId: string, file: string): Promise<Response> {
  const feed = await feedForReadId(readId);
  const image = feed && (await loadImage(feed, file));
  if (!image) return new Response("not found", { status: 404 });
  return new Response(image.bytes as BodyInit, {
    headers: {
      "Content-Type": image.contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
