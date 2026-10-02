// Notes: validation, ids and reading them back. Storage itself is in data/notes.ts.
import { extractTitle, idStamp, slugify } from "../shared/notes";
import { isErrno } from "./data/fs";
import { deleteNoteFile, replaceNote, writeNote, listNoteFiles, readNote } from "./data/notes";
import { EmptyNoteError, NoteTooLargeError } from "./errors";
import { assertFeed, checkFeed, ensureFeed, forgetFeed } from "./feeds";

export type Note = { id: string; title: string; markdown: string; createdAt: Date; sender?: string };

export const MAX_BYTES = 102400;

const ID_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[a-z0-9-]+$/;

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

function toNote(id: string, { markdown, sender }: { markdown: string; sender?: string }): Note {
  const [, y, mo, d, h, mi, s] = ID_RE.exec(id)!;
  return {
    id,
    title: extractTitle(markdown),
    markdown,
    createdAt: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)),
    ...(sender !== undefined && { sender }),
  };
}

// Storage only: no auth, rate limit or caps (that is posting.ts).
export function checkMarkdown(markdown: string): void {
  if (markdown.trim() === "") throw new EmptyNoteError();
  if (Buffer.byteLength(markdown, "utf8") > MAX_BYTES) throw new NoteTooLargeError();
}

// `readId`: the read id of the feed the note went into (null: that feed has no read link).
export async function createNote(feed: string, markdown: string, now = new Date(), sender?: string): Promise<{ note: Note; readId: string | null }> {
  assertFeed(feed);
  checkMarkdown(markdown);
  // ponytail: checked, not locked. A post that is past ensureFeed when its feed is deleted and the name
  // re-created lands in the new feed (as do settings written after hasFeed); a per-feed lock would close it.
  const base = `${idStamp(now)}-${slugify(extractTitle(markdown))}`;
  for (let retried = false; ; retried = true) {
    const readId = await ensureFeed(feed);
    try {
      return { note: toNote(await writeNote(feed, base, markdown, sender), { markdown, sender }), readId };
    } catch (e) {
      // The listed feed's directory is gone (deleted since ensureFeed, or removed by hand): this is a new
      // feed. Once only: gone again means another delete, and that is an error.
      if (retried || !isErrno(e, "ENOENT")) throw e;
      await forgetFeed(feed, readId);
    }
  }
}

async function noteIds(feed: string): Promise<string[]> {
  if (checkFeed(feed)) return [];
  return (await listNoteFiles(feed)).filter(isValidId);
}

// Newest first. `before` (a note id) pages backwards: ids sort by time, so older notes sort lower.
export async function listNotes(feed: string, limit = 50, before?: string): Promise<Note[]> {
  const ids = (await noteIds(feed))
    .filter((id) => before === undefined || id < before)
    .sort()
    .reverse()
    .slice(0, limit);
  const notes = await Promise.all(ids.map((id) => getNote(feed, id)));
  return notes.filter((n) => n !== null); // a note deleted between readdir and read
}

export async function countNotes(feed: string): Promise<number> {
  return (await noteIds(feed)).length;
}

export async function getNote(feed: string, id: string): Promise<Note | null> {
  if (checkFeed(feed) || !isValidId(id)) return null;
  const stored = await readNote(feed, id);
  return stored === null ? null : toNote(id, stored);
}

// The id never changes, so neither does createdAt. null: invalid feed or id, or no such note.
export async function updateNote(feed: string, id: string, markdown: string): Promise<Note | null> {
  checkMarkdown(markdown);
  if (checkFeed(feed) || !isValidId(id)) return null;
  return (await replaceNote(feed, id, markdown)) ? getNote(feed, id) : null;
}

export async function removeNote(feed: string, id: string): Promise<boolean> {
  return !checkFeed(feed) && isValidId(id) && (await deleteNoteFile(feed, id));
}
