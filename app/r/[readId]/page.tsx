import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NoteList } from "@/components/NoteList";
import { getReadFeed, instanceTitle, readPath, rssPath } from "@/backend";

export const dynamic = "force-dynamic";

// Read-only and public even on a locked instance (proxy.ts skips /r/). Never render the feed name.
export async function generateMetadata({ params }: PageProps<"/r/[readId]">): Promise<Metadata> {
  const { readId } = await params;
  return {
    title: { absolute: instanceTitle() },
    alternates: { types: { "application/rss+xml": rssPath(readId) } },
  };
}

// Like the RSS route: a malformed id is a 404, an unknown one an empty feed.
export default async function ReadPage({ params }: PageProps<"/r/[readId]">) {
  const { readId } = await params;
  const data = await getReadFeed(readId);
  if (!data) notFound();
  const { notes } = data;

  return (
    <>
      <Header rss={rssPath(readId)} />
      {notes.length === 0 ? (
        <p className="text-muted">No notes yet.</p>
      ) : (
        <NoteList notes={notes} base={readPath(readId)} />
      )}
    </>
  );
}
