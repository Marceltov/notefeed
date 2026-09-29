import Link from "next/link";
import { headers } from "next/headers";
import { Compose } from "@/components/Compose";
import { Header } from "@/components/Header";
import { NoteView } from "@/components/NoteView";
import { listNotes, type Note } from "@/lib/notes";
import { bodyAfterTitle } from "@/lib/slug";
import { publicUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

// Times use the server's TZ (set TZ in compose.yaml).
const dayKey = (d: Date) => d.toLocaleDateString("en-CA");
const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Today";
  if (dayKey(d) === dayKey(yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function groupByDay(notes: Note[]): [string, Note[]][] {
  const groups = new Map<string, Note[]>();
  for (const n of notes) {
    const label = dayLabel(n.createdAt);
    groups.set(label, [...(groups.get(label) ?? []), n]);
  }
  return [...groups];
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const { posted } = await searchParams;
  const notes = await listNotes(50);
  const base = publicUrl(await headers());

  return (
    <>
      <Header />
      <Compose key={String(posted)} />
      {notes.length === 0 ? (
        <section className="text-muted">
          <p>No notes yet. Write one above, or post from a script:</p>
          <pre className="mt-3 overflow-x-auto font-mono text-sm text-ink">
            {`curl -H "Authorization: Bearer $NOTEFEED_TOKEN" \\\n  --data-binary @note.md ${base}/api/notes`}
          </pre>
        </section>
      ) : (
        groupByDay(notes).map(([day, items]) => (
          <section key={day} aria-labelledby={`day-${dayKey(items[0].createdAt)}`} className="mb-10">
            <h2 id={`day-${dayKey(items[0].createdAt)}`} className="mb-3 border-b border-rule pb-1 font-bold">
              {day}
            </h2>
            <ol className="space-y-6">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`grid grid-cols-[3.5rem_1fr] gap-x-3 rounded-sm ${n.id === posted ? "arrived" : ""}`}
                >
                  <time dateTime={n.createdAt.toISOString()} className="pt-px text-sm tabular-nums text-muted">
                    {time(n.createdAt)}
                  </time>
                  <div className="min-w-0">
                    <Link href={`/n/${n.id}`} className="font-bold hover:text-carbon hover:underline">
                      {n.title || n.id}
                    </Link>
                    {bodyAfterTitle(n.markdown) && (
                      <div className="mt-1">
                        <NoteView markdown={bodyAfterTitle(n.markdown)} />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </>
  );
}
