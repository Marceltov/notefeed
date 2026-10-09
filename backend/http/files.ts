// GET /r/<readId>/<file> (next.config.ts rewrites a name with an extension here; note ids have none): a file of the feed, public like the read
// link (no password, even on a locked instance; proxy.ts skips /r/). Every file is served except dot files (the feed's own files and the
// notes' sidecars). The type comes from the extension and nothing else, whatever follows the header; what is not an image or text is a download.
import { createHash } from "node:crypto";
import { feedForReadId } from "../feeds";
import { measured } from "../metrics";
import { noteRoute } from "../requestscope";
import { storage } from "../storage";
import { IMAGE_EXTS, contentTypeOf } from "../../shared/images";

const NAME_RE = /^[A-Za-z0-9_-]{1,128}\.([A-Za-z0-9]{1,16})$/;

// A file can be replaced under the same name (a note's `PUT`), so nothing is cached for good: the cache asks again with the ETag, a hash of the
// bytes, and gets a bodyless 304 while the file is unchanged. `ifNoneMatch` is the request's header, if any.
export const fileRoute = (readId: string, file: string, ifNoneMatch?: string | null): Promise<Response> =>
  measured("feed_file", () => serveFile(readId, file, ifNoneMatch), (r) => r.status);

async function serveFile(readId: string, file: string, ifNoneMatch?: string | null): Promise<Response> {
  noteRoute("/r/[readId]/files/[file]"); // reached by a rewrite: the path has the shape of a note's page
  const feed = await feedForReadId(readId);
  const ext = NAME_RE.exec(file)?.[1];
  const bytes = feed && ext ? await storage().readFile(feed, file) : null;
  if (!bytes || !ext) return new Response("not found", { status: 404 });
  const image = (IMAGE_EXTS as string[]).includes(ext);
  const etag = `"${createHash("sha1").update(bytes).digest("base64url")}"`;
  const headers = {
    "Content-Type": contentTypeOf(ext),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
    ETag: etag,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    ...(!image && ext !== "md" && { "Content-Disposition": "attachment" }),
  };
  if (ifNoneMatch?.split(",").some((t) => t.trim() === etag)) return new Response(null, { status: 304, headers });
  return new Response(bytes as BodyInit, { headers });
}
