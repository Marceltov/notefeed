import { renderFeed } from "@/lib/feed";
import { READ_ID_RE, feedForReadId } from "@/lib/feeds";
import { listNotes } from "@/lib/notes";
import { publicUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

// Public even on a locked instance (proxy.ts skips /r/). Unknown ids get an empty feed,
// so a reader can subscribe before the first note and ids can't be probed for existence.
export async function GET(req: Request, { params }: { params: Promise<{ readId: string }> }) {
  const { readId } = await params;
  if (!READ_ID_RE.test(readId)) return new Response("not found", { status: 404 });
  const feed = await feedForReadId(readId);
  const xml = renderFeed(feed ? await listNotes(feed, 50) : [], {
    title: process.env.NOTEFEED_TITLE || "notefeed",
    baseUrl: publicUrl(req.headers),
    readId,
  });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
