import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NoteArticle } from "@/components/NoteList";
import { READ_ID_RE, feedForReadId } from "@/lib/feeds";
import { getNote } from "@/lib/notes";

export const dynamic = "force-dynamic";

// Never render the feed name here, not even in the title.
export const generateMetadata = (): Metadata => ({ title: { absolute: process.env.NOTEFEED_TITLE || "notefeed" } });

export default async function ReadNotePage({ params }: PageProps<"/r/[readId]/[id]">) {
  const { readId, id } = await params;
  const feed = READ_ID_RE.test(readId) ? await feedForReadId(readId) : null;
  const note = feed ? await getNote(feed, id) : null;
  if (!note) notFound();

  return (
    <>
      <Header rss={`/r/${readId}/feed.xml`} />
      <NoteArticle note={note} back={`/r/${readId}`} />
    </>
  );
}
