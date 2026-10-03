// Notes: validation, ids and reading them back. Storage itself is in data/notes.ts.
import { randomBytes } from "node:crypto";
import { idStamp } from "../shared/notes";
import { isErrno } from "./data/fs";
import { deleteNoteFile, replaceNote, writeNote, listNoteFiles, readNote, type Meta } from "./data/notes";
import { EmptyNoteError, NoteTooLargeError } from "./errors";
import { assertFeed, checkFeed, ensureFeed, forgetFeed } from "./feeds";
import { MarkdownNote } from "./note/markdown";
import { typeForExt } from "./note/types";

export { MarkdownNote } from "./note/markdown";
// ponytail: only markdown notes exist until image notes (Task 3 widens these to Note).
export type Note = MarkdownNote;

export const MAX_BYTES = 102400;

// A UUID v7: the millisecond clock first, so ids made in the same second still sort in the order they were made
// (ids sort as strings, newest last). ponytail: within one millisecond the order is random.
function uuidV7(now: Date): string {
  const b = randomBytes(16);
  b.writeUIntBE(now.getTime(), 0, 6);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const ID_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[a-z0-9-]+$/;

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

function createdAt(id: string): Date {
  const [, y, mo, d, h, mi, s] = ID_RE.exec(id)!;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

// Storage only: no auth, rate limit or caps (that is posting.ts).
export function checkMarkdown(markdown: string): void {
  if (markdown.trim() === "") throw new EmptyNoteError();
  if (Buffer.byteLength(markdown, "utf8") > MAX_BYTES) throw new NoteTooLargeError();
}

// `readId`: the read id of the feed the note went into (null: that feed has no read link).
// `wantedReadId` is used only if this call creates the feed (feeds.ts).
export async function createNote(feed: string, markdown: string, now = new Date(), sender?: string, tags: string[] = [], wantedReadId?: string): Promise<{ note: Note; readId: string | null }> {
  assertFeed(feed);
  checkMarkdown(markdown);
  // ponytail: checked, not locked. A post that is past ensureFeed when its feed is deleted and the name
  // re-created lands in the new feed (as do settings written after hasFeed); a per-feed lock would close it.
  const base = `${idStamp(now)}-${uuidV7(now)}`;
  for (let retried = false; ; retried = true) {
    const readId = await ensureFeed(feed, wantedReadId);
    try {
      const meta: Meta = { ...(sender !== undefined && { sender }), ...(tags.length && { tags }) };
      const id = await writeNote(feed, base, "md", markdown, meta);
      return { note: new MarkdownNote({ id, ext: "md", meta, createdAt: createdAt(id), size: Buffer.byteLength(markdown) }, markdown), readId };
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
  return (await listNoteFiles(feed)).filter((e) => typeForExt(e.ext)).map((e) => e.id).filter(isValidId);
}

// Newest first. `before` (a note id) pages backwards: ids sort by time, so older notes sort lower.
// `tag`: only notes carrying it; the files are read newest first until `limit` match.
export async function listNotes(feed: string, limit = 50, before?: string, tag?: string): Promise<Note[]> {
  const ids = (await noteIds(feed))
    .filter((id) => before === undefined || id < before)
    .sort()
    .reverse();
  const read = async (page: string[]) => (await Promise.all(page.map((id) => getNote(feed, id)))).filter((n) => n !== null); // null: deleted between readdir and read
  if (tag === undefined) return read(ids.slice(0, limit));
  // ponytail: a rare tag reads every note of the feed; a tag index would fix it if feeds get large.
  const found: Note[] = [];
  for (let i = 0; i < ids.length && found.length < limit; i += limit) {
    found.push(...(await read(ids.slice(i, i + limit))).filter((n) => n.tags.includes(tag)));
  }
  return found.slice(0, limit);
}

export async function countNotes(feed: string): Promise<number> {
  return (await noteIds(feed)).length;
}

export async function getNote(feed: string, id: string): Promise<Note | null> {
  if (checkFeed(feed) || !isValidId(id)) return null;
  const stored = await readNote(feed, id);
  const type = stored && typeForExt(stored.ext);
  return stored && type ? (type.read({ id, ext: stored.ext, meta: stored.meta, createdAt: createdAt(id), size: stored.content.length }, stored.content) as MarkdownNote) : null;
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
