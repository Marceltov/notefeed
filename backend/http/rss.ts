// GET /r/<readId>/feed.xml. Public even on a locked instance (proxy.ts skips /r/). Unknown ids get an
// empty feed, so a reader can subscribe before the first note and ids can't be probed for existence.
import { config } from "../config";
import { isReadId, feedForReadId } from "../feeds";
import { getSettings } from "../feedsettings";
import { listNotes } from "../notes";
import { renderFeed } from "../rss";
import { imagePath, publicUrl } from "../urls";

export async function rssRoute(req: Request, readId: string): Promise<Response> {
  if (!isReadId(readId)) return new Response("not found", { status: 404 });
  const feed = await feedForReadId(readId);
  const settings = feed ? await getSettings(feed) : { title: "", description: "", image: "" };
  const title = settings.title || config.title();
  const xml = renderFeed(feed ? await listNotes(feed, 50) : [], {
    title,
    description: settings.description || title,
    baseUrl: publicUrl(req.headers),
    readId,
    imageUrl: settings.image ? publicUrl(req.headers) + imagePath(readId, settings.image) : undefined,
  });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
