import type { Metadata } from "next";
import { Header } from "@/components/Header";

export const metadata: Metadata = { title: "Imprint" };

export default function Imprint() {
  return (
    <>
      <Header />
      <main className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">Imprint</h1>
        <p>
          Marcel Bruckner
          <br />
          Contact:{" "}
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
        <h2 className="pt-2 font-bold">Responsibility for content</h2>
        <p>
          I only provide the platform. Notes, feed names and images are written
          and uploaded by its users, and I am not responsible for them. If you
          find content that is unlawful, tell me through the contact above and I
          will look at it and remove it where required.
        </p>
      </main>
    </>
  );
}
