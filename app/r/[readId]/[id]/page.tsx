import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NoteArticle } from "@/components/NoteList";
import { getReadNote, instanceTitle, readPath, rssPath } from "@/backend";

export const dynamic = "force-dynamic";

// Never render the feed name here, not even in the title.
export const generateMetadata = (): Metadata => ({ title: { absolute: instanceTitle() } });

export default async function ReadNotePage({ params }: PageProps<"/r/[readId]/[id]">) {
  const { readId, id } = await params;
  const note = await getReadNote(readId, id);
  if (!note) notFound();

  return (
    <>
      <Header rss={rssPath(readId)} />
      <NoteArticle note={note} back={readPath(readId)} />
    </>
  );
}
