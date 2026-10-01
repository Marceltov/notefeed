// Notes: validation, ids and reading them back. Storage itself is in data/notes.ts.
import { extractTitle, idStamp, slugify } from "../shared/notes";
import { writeNote, listNoteFiles, readNote } from "./data/notes";
import { EmptyNoteError, NoteTooLargeError } from "./errors";
import { addFeed, assertFeed, checkFeed } from "./feeds";

export type Note = { id: string; title: string; markdown: string; createdAt: Date };

export const MAX_BYTES = 102400;

const ID_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[a-z0-9-]+$/;

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

function toNote(id: string, markdown: string): Note {
  const [, y, mo, d, h, mi, s] = ID_RE.exec(id)!;
  return {
    id,
    title: extractTitle(markdown),
    markdown,
    createdAt: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)),
  };
}

// Storage only: no auth, rate limit or caps (that is posting.ts).
export async function createNote(feed: string, markdown: string, now = new Date()): Promise<Note> {
  assertFeed(feed);
  if (markdown.trim() === "") throw new EmptyNoteError();
  if (Buffer.byteLength(markdown, "utf8") > MAX_BYTES) throw new NoteTooLargeError();
  const id = await writeNote(feed, `${idStamp(now)}-${slugify(extractTitle(markdown))}`, markdown);
  await addFeed(feed);
  return toNote(id, markdown);
}

async function noteIds(feed: string): Promise<string[]> {
  if (checkFeed(feed)) return [];
  return (await listNoteFiles(feed)).filter(isValidId);
}

// Newest first.
export async function listNotes(feed: string, limit = 50): Promise<Note[]> {
  const ids = (await noteIds(feed)).sort().reverse().slice(0, limit);
  const notes = await Promise.all(ids.map((id) => getNote(feed, id)));
  return notes.filter((n) => n !== null); // a note deleted between readdir and read
}

export async function countNotes(feed: string): Promise<number> {
  return (await noteIds(feed)).length;
}

export async function getNote(feed: string, id: string): Promise<Note | null> {
  if (checkFeed(feed) || !isValidId(id)) return null;
  const markdown = await readNote(feed, id);
  return markdown === null ? null : toNote(id, markdown);
}
