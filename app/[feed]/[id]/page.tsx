import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NoteArticle } from "@/components/NoteList";
import { NoteActions } from "@/components/NoteActions";
import { UnlockForm } from "@/components/UnlockForm";
import { noteErrorMessage } from "@/app/_lib/messages";
import { feedCookieName, feedPath, feedUnlocked, getFeedNote } from "@/backend";

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

  return (
    <>
      <Header feed={feed} />
      {edited === "1" && (
        <p role="status" className="mb-4 text-sm text-carbon">
          Saved.
        </p>
      )}
      <NoteArticle note={note} back={feedPath(feed)} />
      <NoteActions key={note.markdown} feed={feed} id={id} markdown={note.markdown} error={noteErrorMessage(error, retry)} />
    </>
  );
}
