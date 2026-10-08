import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NoteView } from "@/components/NoteView";
import { readLegalPage, type LegalPage as Which } from "@/backend";

// The operator's own imprint or privacy page: their Markdown file, shown like a note (raw HTML stays text). notefeed
// ships no such text, so without a file there is no page.
export async function LegalPage({ which }: { which: Which }) {
  const markdown = await readLegalPage(which);
  if (markdown === null) notFound();
  return (
    <>
      <Header />
      <main>
        <NoteView markdown={markdown} />
      </main>
    </>
  );
}
