import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Compose } from "@/components/Compose";
import { CopyButton } from "@/components/CopyButton";
import { Header } from "@/components/Header";
import { NoteList } from "@/components/NoteList";
import { locked } from "@/lib/auth";
import { checkFeed, readId } from "@/lib/feeds";
import { listNotes } from "@/lib/notes";
import { publicUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[feed]">): Promise<Metadata> {
  const { feed } = await params;
  return checkFeed(feed) ? {} : { title: feed };
}

export default async function FeedPage({ params, searchParams }: PageProps<"/[feed]">) {
  const { feed } = await params;
  if (checkFeed(feed)) notFound();
  const { posted } = await searchParams;
  const notes = await listNotes(feed, 50);
  const base = publicUrl(await headers());
  const rid = readId(feed);
  const readUrl = `${base}/r/${rid}/feed.xml`;
  const auth = locked() ? ` -H "Authorization: Bearer $NOTEFEED_PASSWORD"` : "";
  const curlExample = `curl${auth} -d "# Hello" ${base}/${feed}`;

  return (
    <>
      <Header feed={feed} rss={readUrl} />
      <Compose key={String(posted)} feed={feed} />
      <section aria-labelledby="read-link" className="-mt-6 mb-10 text-sm">
        <h2 id="read-link" className="font-bold">
          Read link
        </h2>
        <p className="text-muted">
          For RSS readers and sharing: it shows the notes but not this feed&apos;s name, and can&apos;t post.{" "}
          <Link href={`/r/${rid}`} className="text-carbon hover:underline">
            Open read-only view
          </Link>
        </p>
        <div className="mt-1 flex items-baseline gap-3">
          <code className="min-w-0 break-all font-mono text-carbon">{readUrl}</code>
          <CopyButton text={readUrl} />
        </div>
      </section>
      {notes.length === 0 ? (
        <section className="text-muted">
          <p>No notes yet. Write one above, or post from a script:</p>
          <pre className="mt-3 overflow-x-auto font-mono text-sm text-ink">{curlExample}</pre>
        </section>
      ) : (
        <>
          <details className="-mt-4 mb-10 text-sm text-muted">
            <summary className="cursor-pointer select-none hover:text-ink">Post from a script</summary>
            <pre className="mt-2 overflow-x-auto font-mono text-ink">{curlExample}</pre>
          </details>
          <NoteList notes={notes} base={`/${feed}`} posted={typeof posted === "string" ? posted : undefined} />
        </>
      )}
    </>
  );
}
