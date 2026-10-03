import Link from "next/link";
import { NoteView } from "@/components/NoteView";
import type { Note } from "@/backend";
import { bodyAfterTitle } from "@/shared/notes";

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

// Tags link to the list filtered by that tag (`${base}?tag=…`).
function Tags({ tags, base }: { tags: string[]; base: string }) {
  return tags.map((t) => (
    <Link key={t} href={`${base}?tag=${encodeURIComponent(t)}`} className="ml-2 rounded-sm border border-rule px-1.5 text-sm text-muted hover:text-carbon hover:underline">
      {t}
    </Link>
  ));
}

// An image note's picture, from the feed's current read link (`imageBase`), so it follows a changed read id. The text alternative is
// the note's own, else its title, else none: a picture without a description is decoration to a screen reader, not a file name.
function Picture({ note, imageBase, className }: { note: Note; imageBase?: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={(imageBase ?? "") + note.file} alt={note.alt ?? note.title} loading="lazy" className={className} />;
}

// Notes grouped by day; each title links to `${base}/${id}`. `imageBase` is where a note's relative image links point.
export function NoteList({ notes, base, imageBase, posted }: { notes: Note[]; base: string; imageBase?: string; posted?: string }) {
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
              {n.kind === "image" ? (
                <>
                  {n.title && (
                    <Link href={`${base}/${n.id}`} className="font-bold hover:text-carbon hover:underline">
                      {n.title}
                    </Link>
                  )}
                  <Link href={`${base}/${n.id}`} className="mt-1 block">
                    <Picture note={n} imageBase={imageBase} className="max-h-96 max-w-full rounded-sm" />
                  </Link>
                </>
              ) : (
                <Link href={`${base}/${n.id}`} className="font-bold hover:text-carbon hover:underline">
                  {n.title || n.id}
                </Link>
              )}
              {n.sender && <span className="ml-2 text-sm text-muted">by {n.sender}</span>}
              <Tags tags={n.tags} base={base} />
              {bodyAfterTitle(n.markdown) && (
                <div className="mt-1">
                  <NoteView markdown={bodyAfterTitle(n.markdown)} imageBase={imageBase} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  ));
}

export function NoteArticle({ note, back, imageBase }: { note: Note; back: string; imageBase?: string }) {
  return (
    <>
      <article>
        <time dateTime={note.createdAt.toISOString()} className="text-sm text-muted">
          {note.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
        </time>
        {note.sender && <span className="text-sm text-muted"> by {note.sender}</span>}
        <Tags tags={note.tags} base={back} />
        <div className="mt-2">
          {note.kind === "image" ? (
            <>
              {note.title && <h1 className="mb-2 text-xl font-bold">{note.title}</h1>}
              <Picture note={note} imageBase={imageBase} className="max-w-full rounded-sm" />
            </>
          ) : (
            <NoteView markdown={note.markdown} imageBase={imageBase} />
          )}
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

// Shown above a filtered list: what it is filtered by, and the way back to all notes.
export function TagFilter({ tag, base }: { tag: string; base: string }) {
  return (
    <p className="mb-6 text-sm text-muted">
      Notes tagged <span className="font-mono text-ink">{tag}</span> ·{" "}
      <Link href={base} className="text-carbon hover:underline">
        Show all notes
      </Link>
    </p>
  );
}
