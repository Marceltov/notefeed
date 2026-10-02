import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import { publicUrl } from "@/backend";
import "./globals.css";

const sans = Atkinson_Hyperlegible_Next({ variable: "--font-atkinson", subsets: ["latin"] });
const mono = Atkinson_Hyperlegible_Mono({ variable: "--font-atkinson-mono", subsets: ["latin"] });

const description = "Markdown notes under a name. Post with curl, follow in any RSS reader.";

// metadataBase makes the share image's URL absolute, on whatever host this instance is reached.
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(publicUrl(await headers())),
    title: { default: "notefeed", template: "%s · notefeed" },
    description,
  };
}

export const viewport: Viewport = { themeColor: [{ color: "#f2f3f0", media: "(prefers-color-scheme: light)" }, { color: "#15161b", media: "(prefers-color-scheme: dark)" }] };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} antialiased`}>
      <body className="font-sans text-base leading-relaxed">
        <div className="mx-auto max-w-[68ch] px-4 py-8 sm:py-12">{children}
          <footer className="mt-12 flex gap-5 border-t border-rule pt-4 text-sm text-muted">
            <a href="https://docs.notefeed.me/" className="hover:text-ink hover:underline">
              Docs
            </a>
            <Link href="/imprint" className="hover:text-ink hover:underline">
              Imprint
            </Link>
            <Link href="/privacy" className="hover:text-ink hover:underline">
              Data privacy
            </Link>
          </footer>
        </div>
      </body>
    </html>
  );
}
