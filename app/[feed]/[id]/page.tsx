import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NoteArticle } from "@/components/NoteList";
import { NoteActions } from "@/components/NoteActions";
import { UnlockForm } from "@/components/UnlockForm";
import { noteErrorMessage } from "@/app/_lib/messages";
import { feedCookieName, feedPath, feedUnlocked, getFeedNote, imageUploadsOn, readIdOf, readPath } from "@/backend";

export const dynamic = "force-dynamic";

export default async function NotePage({ params, searchParams }: PageProps<"/[feed]/[id]">) {
  const { feed, id } = await params;
  const { edited, error, retry } = await searchParams;
  if ((await feedUnlocked(feed, (await cookies()).get(feedCookieName(feed))?.value)) === "locked") {
    return (
      <>
        <Header feed={feed} />
        <UnlockForm feed={feed} />
      </>
    );
  }
  const note = await getFeedNote(feed, id);
  if (!note) notFound();
  const readId = await readIdOf(feed);

  return (
    <>
      <Header feed={feed} />
      {edited === "1" && (
        <p role="status" className="mb-4 text-sm text-carbon">
          Saved.
        </p>
      )}
      <NoteArticle note={note} back={feedPath(feed)} imageBase={readId ? `${readPath(readId)}/` : undefined} />
      <NoteActions key={`${note.content}\n${note.meta.title}\n${note.alt}`} feed={feed} id={id} kind={note.type.startsWith("image/") ? "image" : "markdown"} markdown={note.content ?? ""} title={note.meta.title ?? ""} alt={note.alt ?? ""} error={noteErrorMessage(error, retry)} images={imageUploadsOn()} />
    </>
  );
}
