// Notes: validation, ids and reading them back. Storage itself is in data/notes.ts.
import { randomBytes } from "node:crypto";
import { idStamp } from "../shared/notes";
import { isErrno } from "./data/fs";
import { deleteNoteFile, replaceNote, updateMeta, writeNote, listNoteFiles, readNote, type Meta } from "./data/notes";
import { EmptyNoteError, InvalidBodyError, NoteTooLargeError, UnsupportedTypeError } from "./errors";
import { assertFeed, checkFeed, ensureFeed, forgetFeed } from "./feeds";
import { sniffImage } from "./images";
import { ImageNote } from "./note/image";
import { MarkdownNote } from "./note/markdown";
import { Note } from "./note/note";
import { typeForExt } from "./note/types";

export { ImageNote, MarkdownNote, Note };

export const MAX_BYTES = 102400;
export const MAX_NOTE_TITLE = 100;
export const MAX_ALT = 500;

// A note's title or alt text: trimmed, one line of at most `max` characters (an emoji is one). "" means none.
export function checkLine(name: string, value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (/[\x00-\x1f\x7f]/.test(v)) throw new InvalidBodyError(`${name} must be one line`);
  if ([...v].length > max) throw new InvalidBodyError(`${name} must be at most ${max} characters`);
  return v;
}

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

// What a new note is made of; the feed is created if it doesn't exist (`wantedReadId` is used only then, see feeds.ts).
type NewNote = { ext: string; content: string | Uint8Array; meta: Meta };

// `readId`: the read id of the feed the note went into (null: that feed has no read link).
async function store(feed: string, { ext, content, meta }: NewNote, now: Date, wantedReadId?: string): Promise<{ id: string; readId: string | null }> {
  // ponytail: checked, not locked. A post that is past ensureFeed when its feed is deleted and the name
  // re-created lands in the new feed (as do settings written after hasFeed); a per-feed lock would close it.
  const base = `${idStamp(now)}-${uuidV7(now)}`;
  for (let retried = false; ; retried = true) {
    const readId = await ensureFeed(feed, wantedReadId);
    try {
      return { id: await writeNote(feed, base, ext, content, meta), readId };
    } catch (e) {
      // The listed feed's directory is gone (deleted since ensureFeed, or removed by hand): this is a new
      // feed. Once only: gone again means another delete, and that is an error.
      if (retried || !isErrno(e, "ENOENT")) throw e;
      await forgetFeed(feed, readId);
    }
  }
}

export async function createNote(feed: string, markdown: string, now = new Date(), sender?: string, tags: string[] = [], wantedReadId?: string, title?: string): Promise<{ note: MarkdownNote; readId: string | null }> {
  assertFeed(feed);
  checkMarkdown(markdown);
  const given = checkLine("title", title, MAX_NOTE_TITLE);
  const meta: Meta = { ...(sender !== undefined && { sender }), ...(tags.length && { tags }), ...(given && { title: given }) };
  const { id, readId } = await store(feed, { ext: "md", content: markdown, meta }, now, wantedReadId);
  return { note: new MarkdownNote({ id, ext: "md", meta, createdAt: stampOf(id)!, size: Buffer.byteLength(markdown) }, markdown), readId };
}

/** An image as a note of its own. The format is decided by the bytes (UnsupportedTypeError for anything else, SVG included). */
export async function createImageNote(
  feed: string,
  bytes: Uint8Array,
  opts: { sender?: string; tags?: string[]; title?: string; alt?: string; name?: string; wantedReadId?: string },
  now = new Date(),
): Promise<{ note: ImageNote; readId: string | null }> {
  assertFeed(feed);
  const ext = sniffImage(bytes);
  if (!ext) throw new UnsupportedTypeError("send a PNG, JPEG, GIF or WebP image");
  const { sender, tags = [], name } = opts;
  const title = checkLine("title", opts.title, MAX_NOTE_TITLE);
  const alt = checkLine("alt", opts.alt, MAX_ALT);
  const meta: Meta = { ...(sender !== undefined && { sender }), ...(tags.length && { tags }), ...(title && { title }), ...(alt && { alt }), ...(name && { name }) };
  const { id, readId } = await store(feed, { ext, content: bytes, meta }, now, opts.wantedReadId);
  return { note: new ImageNote({ id, ext, meta, createdAt: stampOf(id)!, size: bytes.length }), readId };
}

async function noteIds(feed: string, kind?: Note["kind"]): Promise<string[]> {
  if (checkFeed(feed)) return [];
  return (await listNoteFiles(feed)).filter((e) => { const type = typeForExt(e.ext); return type && (kind === undefined || type.kind === kind) && isValidId(e.id); }).map((e) => e.id);
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
export async function listNotes(feed: string, limit = 50, before?: string, tag?: string, kind?: Note["kind"]): Promise<Note[]> {
  let ids = await newestFirst(feed, await noteIds(feed, kind));
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

export async function countNotes(feed: string, kind?: Note["kind"]): Promise<number> {
  return (await noteIds(feed, kind)).length;
}

/** Whether `file` (`<id>.<ext>`) is an image note of this feed: the check before a title image points at it. */
export async function hasImageNote(feed: string, file: string): Promise<boolean> {
  const m = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9]{1,16})$/.exec(file);
  const note = m && !checkFeed(feed) ? await getNote(feed, m[1]) : null;
  return note instanceof ImageNote && note.file === file;
}

export async function getNote(feed: string, id: string): Promise<Note | null> {
  if (checkFeed(feed) || !isValidId(id)) return null;
  const stored = await readNote(feed, id);
  const type = stored && typeForExt(stored.ext);
  return stored && type ? type.read({ id, ext: stored.ext, meta: stored.meta, createdAt: createdAt(id, stored.meta, stored.mtime), size: stored.content.length }, stored.content) : null;
}

/** What an edit may change; at least one field. `markdown` only for a markdown note. "" removes a title or alt. */
export type NoteEdit = { markdown?: string; title?: string; alt?: string };

// The id never changes, so neither does createdAt. null: invalid feed or id, or no such note. A refusal (blank or big markdown,
// a bad title, markdown for an image, alt for a text, nothing to change) throws and changes nothing.
export async function updateNote(feed: string, id: string, edit: NoteEdit): Promise<Note | null> {
  if (edit.markdown === undefined && edit.title === undefined && edit.alt === undefined) throw new InvalidBodyError("nothing to change: send markdown, title or alt");
  if (edit.markdown !== undefined) checkMarkdown(edit.markdown);
  const title = checkLine("title", edit.title, MAX_NOTE_TITLE);
  const alt = checkLine("alt", edit.alt, MAX_ALT);
  if (checkFeed(feed) || !isValidId(id)) return null;
  const note = await getNote(feed, id);
  if (!note) return null;
  if (edit.markdown !== undefined && !(note instanceof MarkdownNote)) throw new InvalidBodyError("an image note has no markdown to replace");
  if (alt !== undefined && !(note instanceof ImageNote)) throw new InvalidBodyError("alt is for image notes");
  if (edit.markdown !== undefined && !(await replaceNote(feed, id, edit.markdown))) return null;
  if ((title !== undefined || alt !== undefined) && !(await updateMeta(feed, id, { ...(title !== undefined && { title }), ...(alt !== undefined && { alt }) }))) return null;
  return getNote(feed, id);
}

export async function removeNote(feed: string, id: string): Promise<boolean> {
  return !checkFeed(feed) && isValidId(id) && (await deleteNoteFile(feed, id));
}
