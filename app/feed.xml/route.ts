import { renderFeed } from "@/lib/feed";
import { listNotes } from "@/lib/notes";
import { publicUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const xml = renderFeed(await listNotes(50), {
    title: process.env.NOTEFEED_TITLE || "notefeed",
    baseUrl: publicUrl(req.headers),
  });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
