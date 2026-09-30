import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NoteArticle } from "@/components/NoteList";
import { getNote } from "@/lib/notes";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: PageProps<"/[feed]/[id]">) {
  const { feed, id } = await params;
  const note = await getNote(feed, id); // null for an invalid or reserved feed name too
  if (!note) notFound();

  return (
    <>
      <Header feed={feed} />
      <NoteArticle note={note} back={`/${feed}`} />
    </>
  );
}
