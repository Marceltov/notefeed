import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { identityOn } from "@/backend";

export const metadata: Metadata = { title: "Imprint" };

export const dynamic = "force-dynamic"; // identityOn() reads the environment per request

export default function Imprint() {
  return (
    <>
      <Header />
      <main className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">Imprint</h1>
        <h2 className="pt-2 font-bold">Provider (Anbieter, § 5 DDG)</h2>
        <p>
          Marcel Bruckner
          <br />
          Germany
        </p>
        <h2 className="pt-2 font-bold">Contact</h2>
        <p>
          Email:{" "}
          <a
            href="mailto:hello@notefeed.me"
            className="text-carbon underline underline-offset-2"
          >
            hello@notefeed.me
          </a>
          <br />
          Security issues:{" "}
          <a
            href="mailto:security@notefeed.me"
            className="text-carbon underline underline-offset-2"
          >
            security@notefeed.me
          </a>
        </p>
        <h2 className="pt-2 font-bold">Value added tax</h2>
        <p>
          No VAT is charged because of the small business exemption
          (Kleinunternehmerregelung) under § 19 UStG. There is therefore no VAT
          ID.
        </p>
        <h2 className="pt-2 font-bold">
          Responsible for content (§ 18 (2) MStV)
        </h2>
        <p>Marcel Bruckner</p>
        <h2 className="pt-2 font-bold">Responsibility for content</h2>
        <p>
          I only provide the platform. Notes, feed names and images are written
          and uploaded by its users, and I am not responsible for them. If you
          find content that is unlawful, tell me through the contact above and I
          will look at it and remove it where required.
        </p>
        {identityOn() && (
          <>
            <h2 className="pt-2 font-bold">Sign-in</h2>
            <p>
              Signing in is optional and enabled on this instance. A sender name
              (a name or other identifier from the provider, as configured) is stored with the notes
              you post and shown on the feed page, the public read link and RSS
              unless the feed hides it. I am the controller of that data. It is
              removed by deleting or editing the notes. See the data privacy
              page.
            </p>
          </>
        )}
        <h2 className="pt-2 font-bold">Dispute resolution (§ 36 VSBG)</h2>
        <p>
          I am neither willing nor obliged to take part in dispute resolution
          proceedings before a consumer arbitration board.
        </p>
      </main>
    </>
  );
}
