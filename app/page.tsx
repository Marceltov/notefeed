import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { OpenFeed } from "@/components/OpenFeed";
import { NoteView } from "@/components/NoteView";
import { checkFeed, feedPath, readNotice } from "@/backend";
import { normalizeFeedInput, suggestFeedName } from "@/app/_lib/names";

export const dynamic = "force-dynamic";

const MESSAGES = {
  invalid: "Use 1–64 characters: a–z, 0–9, - and _.",
  reserved: "That name is reserved. Pick another.",
};

export default async function Home({ searchParams }: PageProps<"/">) {
  const { feed, deleted } = await searchParams;
  let error: string | undefined;
  if (typeof feed === "string") {
    const name = normalizeFeedInput(feed);
    const bad = checkFeed(name);
    if (!bad) redirect(feedPath(name));
    error = MESSAGES[bad];
  }
  // The operator's own words for everyone who opens the instance (backend/legal.ts); notefeed ships none.
  const notice = await readNotice();

  return (
    <>
      <Header />
      {deleted && (
        <p role="status" className="mb-4 text-sm text-carbon">
          Feed deleted.
        </p>
      )}
      {notice !== null && (
        <aside aria-label="Notice" className="mb-8 rounded-sm border border-l-4 border-error bg-error/10 px-4 py-3">
          <NoteView markdown={notice} />
        </aside>
      )}
      <p className="mb-8">
        A feed is a list of markdown notes with a name. Post to it from this page or with one curl command, and
        follow it in any RSS reader through its read link, which shows the notes but not the name.{" "}
        <strong>Anyone who knows a feed&apos;s name can read and post to it — pick one that&apos;s hard to guess.</strong>
      </p>
      <OpenFeed value={typeof feed === "string" ? feed : suggestFeedName()} error={error} />
    </>
  );
}
