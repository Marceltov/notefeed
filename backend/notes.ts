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

// Ids are not enforced: any name without a dot is one, so a file placed by hand is a note. The ones we make are
// `<stamp>-<uuid v7>`, which carry the time.
const STAMP_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

const stampOf = (id: string): Date | null => {
  const m = STAMP_RE.exec(id);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
};

// The id's time if it has one, else the metadata's `created`, else when the file was last written.
function createdAt(id: string, meta: Meta, mtime: Date): Date {
  const created = meta.created === undefined ? NaN : Date.parse(meta.created);
  return stampOf(id) ?? (Number.isNaN(created) ? mtime : new Date(created));
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
      return { note: new MarkdownNote({ id, ext: "md", meta, createdAt: stampOf(id)!, size: Buffer.byteLength(markdown) }, markdown), readId };
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
  return (await listNoteFiles(feed)).filter((e) => typeForExt(e.ext) && isValidId(e.id)).map((e) => e.id);
}

// Newest first, ties by id. An id with a time is placed without reading anything; the others are looked up.
async function newestFirst(feed: string, ids: string[]): Promise<string[]> {
  const keyed = await Promise.all(
    ids.map(async (id) => ({ id, at: (stampOf(id) ?? (await getNote(feed, id))?.createdAt)?.getTime() ?? 0 })), // gone since the listing: oldest
  );
  return keyed.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1)).map((k) => k.id);
}

// `before` (a note id) pages backwards: the notes after it in that order. A `before` that is gone ends the list.
// `tag`: only notes carrying it; the files are read newest first until `limit` match.
export async function listNotes(feed: string, limit = 50, before?: string, tag?: string): Promise<Note[]> {
  let ids = await newestFirst(feed, await noteIds(feed));
  if (before !== undefined) ids = ids.slice(ids.indexOf(before) + 1 || ids.length);
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
  return stored && type ? (type.read({ id, ext: stored.ext, meta: stored.meta, createdAt: createdAt(id, stored.meta, stored.mtime), size: stored.content.length }, stored.content) as MarkdownNote) : null;
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
