import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";

export const metadata: Metadata = { title: "Data privacy" };

export default function Privacy() {
  return (
    <>
      <Header />
      <main className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">Data privacy</h1>
        <p>Marcel Bruckner runs this notefeed instance. This is what it stores about you.</p>
        <h2 className="pt-2 font-bold">Notes, feeds and images</h2>
        <p>
          What you post is stored on the server as you sent it: the notes, the feed name, the optional feed title,
          description and title image, and uploaded images with their metadata (such as GPS position) left in. Feeds
          have no accounts. Anyone who knows a feed&apos;s name can read and post to it, and anyone with its read
          link can read it, images included. Deleting a feed deletes everything in it.
        </p>
        <h2 className="pt-2 font-bold">IP addresses</h2>
        <p>
          Your IP address is used to rate-limit posting and failed password attempts. It is kept in memory only, for
          about a minute, and is not written to disk by notefeed. The server or a reverse proxy in front of it may
          keep ordinary access logs.
        </p>
        <h2 className="pt-2 font-bold">Cookies</h2>
        <p>
          If the instance or a feed is password-protected, a cookie keeps you logged in. It is strictly necessary,
          holds no personal data and carries no tracking. There are no analytics, advertising or third-party
          requests.
        </p>
        <h2 className="pt-2 font-bold">Your rights</h2>
        <p>
          You can delete a feed and its notes yourself. For anything else, such as access to or removal of data,
          use the contact in the <Link href="/imprint" className="text-carbon underline underline-offset-2">imprint</Link>.
        </p>
      </main>
    </>
  );
}
