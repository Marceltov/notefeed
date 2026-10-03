import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Link2, Terminal } from "lucide-react";
import { curlFor } from "@/app/_lib/curl";
import { feedDetailsErrorMessage, feedErrorMessage } from "@/app/_lib/messages";
import { CopyButton } from "@/components/CopyButton";
import { FeedDetails } from "@/components/FeedDetails";
import { FeedSettings } from "@/components/FeedSettings";
import { Header } from "@/components/Header";
import { heading } from "@/components/styles";
import { checkFeed, feedCookieName, feedPath, feedUnlocked, customIdsOn, getFeed, getFeedImages, identityOn, isReservedFeed, publicUrl, readPath, rssPath } from "@/backend";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Feed settings" };

export default async function SettingsPage({ params, searchParams }: PageProps<"/[feed]/settings">) {
  const { feed } = await params;
  const { saved, error, retry, form } = await searchParams;
  if (checkFeed(feed)) notFound();
  const access = await feedUnlocked(feed, (await cookies()).get(feedCookieName(feed))?.value);
  const data = access === "locked" ? null : await getFeed(feed);
  // Locked feeds show only the unlock form on the feed page, and a feed without notes has nothing to set yet.
  if (!data?.exists) redirect(feedPath(feed));
  const { readId, title, description } = data;
  const images = await getFeedImages(feed);
  const base = publicUrl(await headers());
  const readUrl = readId ? base + rssPath(readId) : undefined;
  const detailsError = form === "details";
  const passwordError = !detailsError && access === "unlocked" && ["auth", "invalid_body", "too_many_attempts"].includes(String(error));

  return (
    <>
      <Header feed={feed} rss={readUrl} view={readId ? readPath(readId) : undefined} image={data.imageUrl} />
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Feed settings</h1>
      {saved && (
        <p role="status" className="mb-6 text-sm text-carbon">
          Saved.
        </p>
      )}
      <FeedDetails
        key={`${title}\n${description}\n${data.image}\n${data.showSender}\n${readId}\n${images.map((i) => i.file)}`}
        feed={feed}
        title={title}
        description={description}
        image={data.image}
        imageUrl={data.imageUrl}
        images={images}
        showSender={data.showSender}
        readId={readId}
        readIdChoice={isReservedFeed(feed) ? "fixed" : customIdsOn() ? "custom" : "random"}
        identity={identityOn()}
        error={detailsError ? feedDetailsErrorMessage(error, retry) : undefined}
      >
        <section aria-labelledby="sharing" className="text-sm">
          <h2 id="sharing" className={heading}>
            <Link2 aria-hidden className="h-4 w-4" />
            Read link
          </h2>
          {readUrl ? (
            <>
              <p className="text-muted">For RSS readers and sharing. It shows the notes but not this feed&apos;s name, and can&apos;t post.</p>
              <div className="mt-2 flex items-center gap-3">
                <code className="min-w-0 break-all font-mono text-carbon">{readUrl}</code>
                <CopyButton text={readUrl} />
              </div>
            </>
          ) : (
            <p className="text-muted">The read link appears after the first note.</p>
          )}
          <h2 className={`${heading} mt-6`}>
            <Terminal aria-hidden className="h-4 w-4" />
            Post from a script
          </h2>
          <pre className="overflow-x-auto font-mono text-ink">{curlFor(base, feed, access === "unlocked")}</pre>
        </section>
        {access === "unlocked" && <FeedSettings feed={feed} error={passwordError ? feedErrorMessage(error, retry) : undefined} />}
      </FeedDetails>
    </>
  );
}
