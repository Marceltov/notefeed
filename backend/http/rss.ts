// GET /r/<readId>/feed.xml. Public even on a locked instance (proxy.ts skips /r/). Unknown ids get an
// empty feed, so a reader can subscribe before the first note and ids can't be probed for existence.
import { config } from "../config";
import { READ_ID_RE, feedForReadId } from "../feeds";
import { listNotes } from "../notes";
import { renderFeed } from "../rss";
import { publicUrl } from "../urls";

export async function rssRoute(req: Request, readId: string): Promise<Response> {
  if (!READ_ID_RE.test(readId)) return new Response("not found", { status: 404 });
  const feed = await feedForReadId(readId);
  const xml = renderFeed(feed ? await listNotes(feed, 50) : [], {
    title: config.title(),
    baseUrl: publicUrl(req.headers),
    readId,
  });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
