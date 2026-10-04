import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { notFound } from "next/navigation";
import { Compose } from "@/components/Compose";
import { Header } from "@/components/Header";
import { NoteList, TagFilter } from "@/components/NoteList";
import { UnlockForm } from "@/components/UnlockForm";
import { curlFor } from "@/app/_lib/curl";
import { errorMessage, feedErrorMessage } from "@/app/_lib/messages";
import { checkFeed, feedCookieName, feedPath, feedUnlocked, getFeed, IDENTITY_COOKIE, identitySender, measured, publicUrl, readPath, rssPath, settingsPath } from "@/backend";

export const dynamic = "force-dynamic";

// The metadata and the page share one read per request (the metadata reads it unfiltered). The read is what is measured (kind
// feed_page, feed_page_tag with a tag filter). Without a tag, whichever of the two runs first carries the time and the disk work; with
// one, the metadata's unfiltered read is a feed_page sample of its own and the filtered read a feed_page_tag one.
const loaded = (feed: string, tag?: string) => measured(tag ? "feed_page_tag" : "feed_page", () => getFeed(feed, tag), (data) => (data ? 200 : 404));
const feedData = cache((feed: string) => loaded(feed));

export async function generateMetadata({ params }: PageProps<"/[feed]">): Promise<Metadata> {
  const { feed } = await params;
  if (checkFeed(feed)) return {};
  // A locked feed shows nothing of itself, not even its title.
  const access = await feedUnlocked(feed, (await cookies()).get(feedCookieName(feed))?.value);
  return { title: access === "locked" ? feed : ((await feedData(feed))?.title || feed) };
}

export default async function FeedPage({ params, searchParams }: PageProps<"/[feed]">) {
  const { feed } = await params;
  const { posted, deleted, error, retry, tag: tagParam } = await searchParams;
  const tag = typeof tagParam === "string" ? tagParam.toLowerCase() : undefined;
  const jar = await cookies();
  const access = await feedUnlocked(feed, jar.get(feedCookieName(feed))?.value);
  // A locked feed shows nothing of itself: no notes, no read link.
  if (access === "locked") {
    return (
      <>
        <Header feed={feed} />
        <UnlockForm feed={feed} error={feedErrorMessage(error, retry)} />
      </>
    );
  }
  const data = tag ? await loaded(feed, tag) : await feedData(feed);
  if (!data) notFound();
  const { notes, readId, exists, title, description } = data;
  const base = publicUrl(await headers());
  const readUrl = readId ? base + rssPath(readId) : undefined; // none until the feed has a note
  const curlExample = curlFor(base, feed, access === "unlocked");

  return (
    <>
      <Header feed={feed} rss={readUrl} view={readId ? readPath(readId) : undefined} settingsHref={exists ? settingsPath(feed) : undefined} image={data.imageUrl} />
      {(title || description) && (
        <div className="mb-8">
          {title && <h1 className="text-2xl font-bold tracking-tight">{title}</h1>}
          {description && <p className="mt-1 text-muted">{description}</p>}
        </div>
      )}
      {deleted && (
        <p role="status" className="mb-4 text-sm text-carbon">
          Note deleted.
        </p>
      )}
      <Compose key={String(posted)} feed={feed} action={feedPath(feed)} error={errorMessage(error, retry)}
        isNew={access === "open" && !exists} sender={identitySender(jar.get(IDENTITY_COOKIE)?.value) !== undefined}
      />
      {tag && <TagFilter tag={tag} base={feedPath(feed)} />}
      {tag && notes.length === 0 ? (
        <p className="text-muted">No notes with this tag.</p>
      ) : notes.length === 0 ? (
        <section className="text-muted">
          <p>No notes yet. Write one above, or post from a script:</p>
          <pre className="mt-3 overflow-x-auto font-mono text-sm text-ink">{curlExample}</pre>
        </section>
      ) : (
        <NoteList notes={notes} base={feedPath(feed)} imageBase={readId ? `${readPath(readId)}/` : undefined} posted={typeof posted === "string" ? posted : undefined} />
      )}
    </>
  );
}
