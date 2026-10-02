import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { notFound } from "next/navigation";
import { Compose } from "@/components/Compose";
import { CopyButton } from "@/components/CopyButton";
import { FeedDetails } from "@/components/FeedDetails";
import { FeedSettings } from "@/components/FeedSettings";
import { Header } from "@/components/Header";
import { NoteList } from "@/components/NoteList";
import { UnlockForm } from "@/components/UnlockForm";
import { errorMessage, feedDetailsErrorMessage, feedErrorMessage } from "@/app/_lib/messages";
import { checkFeed, feedCookieName, feedPath, feedUnlocked, getFeed, locked, publicUrl, readPath, rssPath } from "@/backend";

export const dynamic = "force-dynamic";

const feedData = cache(getFeed); // the metadata and the page share one read per request

export async function generateMetadata({ params }: PageProps<"/[feed]">): Promise<Metadata> {
  const { feed } = await params;
  if (checkFeed(feed)) return {};
  // A locked feed shows nothing of itself, not even its title.
  const access = await feedUnlocked(feed, (await cookies()).get(feedCookieName(feed))?.value);
  return { title: access === "locked" ? feed : ((await feedData(feed))?.title || feed) };
}

export default async function FeedPage({ params, searchParams }: PageProps<"/[feed]">) {
  const { feed } = await params;
  const { posted, deleted, saved, error, retry, form } = await searchParams;
  const access = await feedUnlocked(feed, (await cookies()).get(feedCookieName(feed))?.value);
  // A locked feed shows nothing of itself: no notes, no read link.
  if (access === "locked") {
    return (
      <>
        <Header feed={feed} />
        <UnlockForm feed={feed} error={feedErrorMessage(error, retry)} />
      </>
    );
  }
  const data = await feedData(feed);
  if (!data) notFound();
  const { notes, readId, exists, title, description } = data;
  // Which form a refusal belongs to: the settings and delete forms say so (`form=details`; they are only there
  // for a feed that exists), the password forms are the only others that answer with these codes on an unlocked
  // feed, the rest is the compose box.
  const detailsError = form === "details" && exists;
  const settingsError = !detailsError && access === "unlocked" && ["auth", "invalid_body", "too_many_attempts"].includes(String(error));
  const base = publicUrl(await headers());
  const readUrl = readId ? base + rssPath(readId) : undefined; // none until the feed has a note
  const auth =
    (locked() ? ` -H "Authorization: Bearer $NOTEFEED_PASSWORD"` : "") +
    (access === "unlocked" ? ` -H "X-Feed-Password: $NOTEFEED_FEED_PASSWORD"` : "");
  const curlExample = `curl${auth} -d "# Hello" ${base}${feedPath(feed)}`;

  return (
    <>
      <Header feed={feed} rss={readUrl} image={data.imageUrl} />
      {(title || description) && (
        <div className="mb-8">
          {title && <h1 className="text-2xl font-bold tracking-tight">{title}</h1>}
          {description && <p className="mt-1 text-muted">{description}</p>}
        </div>
      )}
      {saved && (
        <p role="status" className="mb-4 text-sm text-carbon">
          Saved.
        </p>
      )}
      {deleted && (
        <p role="status" className="mb-4 text-sm text-carbon">
          Note deleted.
        </p>
      )}
      <Compose key={String(posted)} feed={feed} action={feedPath(feed)} error={settingsError || detailsError ? undefined : errorMessage(error, retry)}
        isNew={access === "open" && !exists} exists={exists}
      />
      {readId && readUrl && (
        <section aria-labelledby="read-link" className="-mt-6 mb-10 text-sm">
          <h2 id="read-link" className="font-bold">
            Read link
          </h2>
          <p className="text-muted">
            For RSS readers and sharing: it shows the notes but not this feed&apos;s name, and can&apos;t post.{" "}
            <Link href={readPath(readId)} className="text-carbon hover:underline">
              Open read-only view
            </Link>
          </p>
          <div className="mt-1 flex items-baseline gap-3">
            <code className="min-w-0 break-all font-mono text-carbon">{readUrl}</code>
            <CopyButton text={readUrl} />
          </div>
        </section>
      )}
      {exists && <FeedDetails key={`${title}\n${description}\n${data.image}`} feed={feed} title={title} description={description} image={data.image} imageUrl={data.imageUrl} error={detailsError ? feedDetailsErrorMessage(error, retry) : undefined} />}
      {access === "unlocked" && <FeedSettings feed={feed} error={settingsError ? feedErrorMessage(error, retry) : undefined} />}
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
          <NoteList notes={notes} base={feedPath(feed)} posted={typeof posted === "string" ? posted : undefined} />
        </>
      )}
    </>
  );
}
