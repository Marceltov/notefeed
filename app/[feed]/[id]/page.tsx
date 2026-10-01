import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NoteArticle } from "@/components/NoteList";
import { feedPath, getFeedNote } from "@/backend";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: PageProps<"/[feed]/[id]">) {
  const { feed, id } = await params;
  const note = await getFeedNote(feed, id);
  if (!note) notFound();

  return (
    <>
      <Header feed={feed} />
      <NoteArticle note={note} back={feedPath(feed)} />
    </>
  );
}
