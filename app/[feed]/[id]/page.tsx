import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NoteArticle } from "@/components/NoteList";
import { UnlockForm } from "@/components/UnlockForm";
import { feedCookieName, feedPath, feedUnlocked, getFeedNote } from "@/backend";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: PageProps<"/[feed]/[id]">) {
  const { feed, id } = await params;
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
      <NoteArticle note={note} back={feedPath(feed)} />
    </>
  );
}
