import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { identityOn } from "@/backend";

export const metadata: Metadata = { title: "Data privacy" };

const link = "text-carbon underline underline-offset-2";

export const dynamic = "force-dynamic"; // identityOn() reads the environment per request

export default function Privacy() {
  return (
    <>
      <Header />
      <main className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">Data privacy</h1>
        <p>
          This explains which personal data this notefeed instance processes
          and why, as required by the GDPR (DSGVO). Last updated: 2 October
          2026.
        </p>
        <h2 className="pt-2 font-bold">Controller (Verantwortlicher)</h2>
        <p>
          Marcel Bruckner, Kempten, Germany. Email:{" "}
          <a href="mailto:privacy@notefeed.me" className={link}>
            privacy@notefeed.me
          </a>
          . No data protection officer is appointed, as none is required.
        </p>
        <h2 className="pt-2 font-bold">Hosting</h2>
        <p>
          The instance runs on my own server in Germany. No hosting provider or
          other processor has access to the data, and no data is transferred to
          third countries.
        </p>
        <h2 className="pt-2 font-bold">Notes, feeds and images</h2>
        <p>
          <strong>What:</strong> what you post is stored as you sent it: the
          notes, the feed name, the optional feed title, description and title
          image, and uploaded images.
          <br />
          <strong>Why and legal basis:</strong> to provide the feed you asked
          for (Art. 6 (1) (b) GDPR).
          <br />
          <strong>Retention:</strong> until you delete the feed. Deleting a feed
          deletes everything in it.
        </p>
        <p>
          <strong>Careful with images:</strong> metadata such as the GPS
          position is left in uploaded images. Anyone who can read the feed can
          see it. Remove it before uploading if you do not want to share it.
        </p>
        <p>
          Feeds have no accounts. Anyone who knows a feed&apos;s name can read
          and post to it, and anyone with its read link can read it, images
          included. Do not post personal data of other people without a reason
          to.
        </p>
        {identityOn() && (
          <>
            <h2 className="pt-2 font-bold">Sign-in and sender name</h2>
            <p>
              <strong>What:</strong> signing in is optional and enabled on this
              instance. If you sign in, a sender name (a name or other identifier
              from your sign-in provider, as the operator configured) is
              stored with the notes you post. It is shown on the feed page, on
              the public read link and in RSS, unless the feed hides it.
              <br />
              <strong>Controller:</strong> the operator named above is the
              controller of this data.
              <br />
              <strong>Removal:</strong> it is removed by deleting the notes, or by
              the operator removing the sender line from the note files.
              Editing a note keeps its sender.
            </p>
          </>
        )}
        <h2 className="pt-2 font-bold">Server logs and IP addresses</h2>
        <p>
          <strong>What:</strong> when you visit, the web server logs your IP
          address, the time, the requested path, the status code and your
          browser&apos;s user agent.
          <br />
          <strong>Why and legal basis:</strong> to keep the service secure and
          to find and stop abuse (Art. 6 (1) (f) GDPR, legitimate interest).
          <br />
          <strong>Retention:</strong> 14 days, then the logs are deleted.
        </p>
        <p>
          Separately, notefeed uses your IP address to rate-limit posting and
          failed password attempts (same legal basis). That is kept in memory
          only, for about a minute, and is not written to disk by notefeed.
        </p>
        <h2 className="pt-2 font-bold">Cookies</h2>
        <p>
          If the instance or a feed is password-protected, a cookie keeps you
          logged in. It is strictly necessary to provide the service you
          requested (§ 25 (2) no. 2 TDDDG), so no consent is needed. It holds no
          personal data and carries no tracking. There are no analytics,
          advertising or third-party requests, and nothing is loaded from
          external servers.
        </p>
        <h2 className="pt-2 font-bold">Recipients and automated decisions</h2>
        <p>
          Your data is not passed on to anyone. There is no automated
          decision-making or profiling.
        </p>
        <h2 className="pt-2 font-bold">Your rights</h2>
        <p>
          You have the right to access (Art. 15), rectification (Art. 16),
          erasure (Art. 17), restriction of processing (Art. 18), data
          portability (Art. 20) and to object to processing based on legitimate
          interest (Art. 21 GDPR). You can delete a feed and its notes
          yourself. For anything else, write to{" "}
          <a href="mailto:privacy@notefeed.me" className={link}>
            privacy@notefeed.me
          </a>
          . I will answer within one month.
        </p>
        <p>
          You also have the right to lodge a complaint with a supervisory
          authority. For me that is the Bavarian State Office for Data
          Protection Supervision (Bayerisches Landesamt für
          Datenschutzaufsicht), Promenade 18, 91522 Ansbach,{" "}
          <a href="https://www.lda.bayern.de" className={link}>
            www.lda.bayern.de
          </a>
          .
        </p>
      </main>
    </>
  );
}
