import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Header } from "@/components/Header";
import { NoteList, TagFilter } from "@/components/NoteList";
import { getReadFeed, instanceTitle, readPath, rssPath } from "@/backend";

export const dynamic = "force-dynamic";

const readFeed = cache(getReadFeed); // the metadata and the page share one read per request

// Read-only and public even on a locked instance (proxy.ts skips /r/). Never render the feed name.
export async function generateMetadata({ params }: PageProps<"/r/[readId]">): Promise<Metadata> {
  const { readId } = await params;
  return {
    title: { absolute: (await readFeed(readId))?.title || instanceTitle() },
    alternates: { types: { "application/rss+xml": rssPath(readId) } },
  };
}

// Like the RSS route: a malformed id is a 404, an unknown one an empty feed.
export default async function ReadPage({ params, searchParams }: PageProps<"/r/[readId]">) {
  const { readId } = await params;
  const { tag: tagParam } = await searchParams;
  const tag = typeof tagParam === "string" ? tagParam.toLowerCase() : undefined;
  const data = tag ? await getReadFeed(readId, tag) : await readFeed(readId);
  if (!data) notFound();
  const { notes, title, description } = data;

  return (
    <>
      <Header rss={rssPath(readId)} image={data.imageUrl} />
      {(title || description) && (
        <div className="mb-8">
          {title && <h1 className="text-2xl font-bold tracking-tight">{title}</h1>}
          {description && <p className="mt-1 text-muted">{description}</p>}
        </div>
      )}
      {tag && <TagFilter tag={tag} base={readPath(readId)} />}
      {notes.length === 0 ? (
        <p className="text-muted">{tag ? "No notes with this tag." : "No notes yet."}</p>
      ) : (
        <NoteList notes={notes} base={readPath(readId)} imageBase={`${readPath(readId)}/`} />
      )}
    </>
  );
}
