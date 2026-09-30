import Link from "next/link";
import { NoteView } from "@/components/NoteView";
import type { Note } from "@/lib/notes";
import { bodyAfterTitle } from "@/lib/slug";

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

// Notes grouped by day; each title links to `${base}/${id}`.
export function NoteList({ notes, base, posted }: { notes: Note[]; base: string; posted?: string }) {
  return groupByDay(notes).map(([day, items]) => (
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
              <Link href={`${base}/${n.id}`} className="font-bold hover:text-carbon hover:underline">
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
  ));
}

export function NoteArticle({ note, back }: { note: Note; back: string }) {
  return (
    <>
      <article>
        <time dateTime={note.createdAt.toISOString()} className="text-sm text-muted">
          {note.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
        </time>
        <div className="mt-2">
          <NoteView markdown={note.markdown} />
        </div>
      </article>
      <p className="mt-10 text-sm">
        <Link href={back} className="text-carbon hover:underline">
          Back to all notes
        </Link>
      </p>
    </>
  );
}
