import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { OpenFeed } from "@/components/OpenFeed";
import { checkFeed } from "@/lib/feeds";
import { normalizeFeedInput, suggestFeedName } from "@/lib/names";

export const dynamic = "force-dynamic";

const MESSAGES = {
  invalid: "Use 1–64 characters: a–z, 0–9, - and _.",
  reserved: "That name is reserved. Pick another.",
};

export default async function Home({ searchParams }: PageProps<"/">) {
  const { feed } = await searchParams;
  let error: string | undefined;
  if (typeof feed === "string") {
    const name = normalizeFeedInput(feed);
    const bad = checkFeed(name);
    if (!bad) redirect(`/${name}`);
    error = MESSAGES[bad];
  }

  return (
    <>
      <Header />
      <p className="mb-8">
        A feed is a list of markdown notes with a name. Post to it from this page or with one curl command, and
        follow it in any RSS reader through its read link, which shows the notes but not the name.{" "}
        <strong>Anyone who knows a feed&apos;s name can read and post to it — pick one that&apos;s hard to guess.</strong>
      </p>
      <OpenFeed value={typeof feed === "string" ? feed : suggestFeedName()} error={error} />
    </>
  );
}
