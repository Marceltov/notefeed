import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NoteList } from "@/components/NoteList";
import { READ_ID_RE, feedForReadId } from "@/lib/feeds";
import { listNotes } from "@/lib/notes";

export const dynamic = "force-dynamic";

// Read-only and public even on a locked instance (proxy.ts skips /r/). Never render the feed name.
export async function generateMetadata({ params }: PageProps<"/r/[readId]">): Promise<Metadata> {
  const { readId } = await params;
  return {
    title: { absolute: process.env.NOTEFEED_TITLE || "notefeed" },
    alternates: READ_ID_RE.test(readId) ? { types: { "application/rss+xml": `/r/${readId}/feed.xml` } } : undefined,
  };
}

// Like the RSS route: a malformed id is a 404, an unknown one an empty feed.
export default async function ReadPage({ params }: PageProps<"/r/[readId]">) {
  const { readId } = await params;
  if (!READ_ID_RE.test(readId)) notFound();
  const feed = await feedForReadId(readId);
  const notes = feed ? await listNotes(feed, 50) : [];

  return (
    <>
      <Header rss={`/r/${readId}/feed.xml`} />
      {notes.length === 0 ? (
        <p className="text-muted">No notes yet.</p>
      ) : (
        <NoteList notes={notes} base={`/r/${readId}`} />
      )}
    </>
  );
}
