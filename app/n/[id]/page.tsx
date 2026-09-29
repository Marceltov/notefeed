import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NoteView } from "@/components/NoteView";
import { getNote } from "@/lib/notes";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: PageProps<"/n/[id]">) {
  const note = await getNote((await params).id);
  if (!note) notFound();

  return (
    <>
      <Header />
      <article>
        <time dateTime={note.createdAt.toISOString()} className="text-sm text-muted">
          {note.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
        </time>
        <div className="mt-2">
          <NoteView markdown={note.markdown} />
        </div>
      </article>
      <p className="mt-10 text-sm">
        <Link href="/" className="text-carbon hover:underline">
          Back to all notes
        </Link>
      </p>
    </>
  );
}
