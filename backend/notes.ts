// Notes: validation, ids and reading them back. Where they are kept is the storage backend's business (backend/storage).
import { randomBytes } from "node:crypto";
import { idStamp } from "../shared/notes";
import { InvalidBodyError, UnsupportedTypeError } from "./errors";
import { assertFeed, checkFeed, ensureFeed, forgetFeed } from "./feeds";
import { storage } from "./storage";
import { FeedGoneError, type Meta, type NoteRef } from "./storage/types";
import { sniffImage } from "../shared/images";
import { cleanName, FORBIDDEN_IN_TEXT, MAX_ALT } from "../shared/links";
import { ImageNote } from "./note/image";
import { MarkdownNote } from "./note/markdown";
import { Note } from "./note/note";
import { NOTE_TYPES, parseMediaType, typeForExt, type NoteType } from "./note/types";

export { checkMarkdown, MAX_BYTES } from "./note/markdown";
export { ImageNote, MarkdownNote, Note };
export { cleanName }; // defined in shared/links.ts, with the characters a name may not hold

export const MAX_NOTE_TITLE = 100;
export { MAX_ALT }; // defined in shared/links.ts: the web box holds to it too

// A note's title or alt text: trimmed, one line of at most `max` characters (an emoji is one). "" means none.
export function checkLine(name: string, value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (FORBIDDEN_IN_TEXT.test(v)) throw new InvalidBodyError(`${name} must be one line, without control or text-direction override characters`);
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
// The extensions that are notes, in the order a lookup tries them.
const NOTE_EXTS = NOTE_TYPES.flatMap((t) => t.exts);
const withContent = (ext: string) => typeForExt(ext)?.needsContent ?? false;

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
      return { id: await storage().writeNote(feed, base, ext, content, meta), readId };
    } catch (e) {
      // The listed feed is gone (deleted since ensureFeed, or its directory removed by hand): this is a new
      // feed. Once only: gone again means another delete, and that is an error.
      if (retried || !(e instanceof FeedGoneError)) throw e;
      await forgetFeed(feed, readId);
    }
  }
}

export type NewNoteOptions = { sender?: string; tags?: string[]; title?: string; alt?: string; name?: string; wantedReadId?: string };

/**
 * A new note of any type: `body` is its file, `ext` the extension its type stores it under. The type's own rules (`checkBody`) apply; a
 * title or alt text must be one short line. The feed is created if it does not exist. Whether the body is what the poster declared is
 * posting.ts's business (`verify`).
 */
export async function createNoteOf(feed: string, type: NoteType, ext: string, body: Uint8Array, opts: NewNoteOptions = {}, now = new Date()): Promise<{ note: Note; readId: string | null }> {
  assertFeed(feed);
  type.checkBody(body);
  const title = checkLine("title", opts.title, MAX_NOTE_TITLE);
  const alt = checkLine("alt", opts.alt, MAX_ALT);
  if (alt && !type.hasAlt) throw new InvalidBodyError("alt is for image notes");
  const { sender, tags = [] } = opts;
  const name = cleanName(opts.name);
  const meta: Meta = { ...(sender !== undefined && { sender }), ...(tags.length && { tags }), ...(title && { title }), ...(alt && { alt }), ...(name && { name }) };
  const { id, readId } = await store(feed, { ext, content: body, meta }, now, opts.wantedReadId);
  return { note: type.read({ id, ext, meta, createdAt: stampOf(id)!, size: body.length }, Buffer.from(body)), readId };
}

export const MARKDOWN = typeForExt("md")!;
export const encoder = new TextEncoder();

/** A markdown note from its text. */
export async function createNote(feed: string, markdown: string, now = new Date(), sender?: string, tags: string[] = [], wantedReadId?: string, title?: string): Promise<{ note: MarkdownNote; readId: string | null }> {
  const made = await createNoteOf(feed, MARKDOWN, "md", encoder.encode(markdown), { sender, tags, title, wantedReadId }, now);
  return { note: made.note as MarkdownNote, readId: made.readId };
}

/** An image as a note of its own. The format is decided by the bytes (UnsupportedTypeError for anything else, SVG included). */
export async function createImageNote(feed: string, bytes: Uint8Array, opts: NewNoteOptions, now = new Date()): Promise<{ note: ImageNote; readId: string | null }> {
  const ext = sniffImage(bytes);
  if (!ext) throw new UnsupportedTypeError();
  const made = await createNoteOf(feed, typeForExt(ext)!, ext, bytes, opts, now);
  return { note: made.note as ImageNote, readId: made.readId };
}

async function noteRefs(feed: string, typeName?: string): Promise<NoteRef[]> {
  if (checkFeed(feed)) return [];
  return (await storage().listNoteRefs(feed)).filter((e) => { const type = typeForExt(e.ext); return type && (typeName === undefined || type.name === typeName) && isValidId(e.id); });
}

// Newest first, ties by id. An id with a time is placed without reading anything; the others are looked up.
async function newestFirst(feed: string, refs: NoteRef[]): Promise<NoteRef[]> {
  const keyed = await Promise.all(
    refs.map(async (ref) => ({ ref, at: (stampOf(ref.id) ?? (await readOf(feed, ref))?.createdAt)?.getTime() ?? 0 })), // gone since the listing: oldest
  );
  return keyed.sort((a, b) => b.at - a.at || (a.ref.id < b.ref.id ? 1 : -1)).map((k) => k.ref);
}

// `before` (a note id) pages backwards: the notes after it in that order. A `before` that is gone ends the list.
// `tag`: only notes carrying it; newest first, the metadata of a chunk is read to choose and the notes themselves only for the
// matches, until `limit` match.
export async function listNotes(feed: string, limit = 50, before?: string, tag?: string, typeName?: string): Promise<Note[]> {
  let refs = await newestFirst(feed, await noteRefs(feed, typeName));
  if (before !== undefined) refs = refs.slice(refs.findIndex((r) => r.id === before) + 1 || refs.length);
  const read = async (page: NoteRef[]) => (await Promise.all(page.map((ref) => readOf(feed, ref)))).filter((n) => n !== null); // null: deleted between the listing and the read
  if (tag === undefined) return read(refs.slice(0, limit));
  // ponytail: a rare tag reads every sidecar of the feed; a tag index would fix it if feeds get large.
  const found: Note[] = [];
  for (let i = 0; i < refs.length && found.length < limit; i += limit) {
    const chunk = refs.slice(i, i + limit);
    const metas = await Promise.all(chunk.map((ref) => storage().readMeta(feed, ref)));
    found.push(...(await read(chunk.filter((_, j) => metas[j]?.tags?.includes(tag)))));
  }
  return found.slice(0, limit);
}

export async function countNotes(feed: string, typeName?: string): Promise<number> {
  return (await noteRefs(feed, typeName)).length;
}

/** Whether `file` (`<id>.<ext>`) is an image note of this feed: the check before a title image points at it. */
export async function hasImageNote(feed: string, file: string): Promise<boolean> {
  const m = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9]{1,16})$/.exec(file);
  const note = m && !checkFeed(feed) ? await getNote(feed, m[1]) : null;
  return note instanceof ImageNote && note.file === file;
}

// The note, found by trying `exts` (a lookup by id alone) or the one extension a listing already knows.
async function readNoteAs(feed: string, id: string, exts: readonly string[]): Promise<Note | null> {
  if (checkFeed(feed) || !isValidId(id)) return null;
  const stored = await storage().readNote(feed, id, exts, withContent);
  const type = stored && typeForExt(stored.ext);
  return stored && type ? type.read({ id, ext: stored.ext, meta: stored.meta, createdAt: createdAt(id, stored.meta, stored.mtime), size: stored.size }, stored.content) : null;
}

const readOf = (feed: string, ref: NoteRef) => readNoteAs(feed, ref.id, [ref.ext]);

export const getNote = (feed: string, id: string): Promise<Note | null> => readNoteAs(feed, id, NOTE_EXTS);

/**
 * Replaces a note's content with `body`, declared as `mediaType`. A note keeps its type, so the declared type must be the note's own
 * (UnsupportedTypeError otherwise); the body gets the checks a new note gets. Id, date and metadata stay. null: invalid feed or id, or no
 * such note.
 */
export async function replaceContent(feed: string, id: string, body: Uint8Array, mediaType: string): Promise<Note | null> {
  const parsed = parseMediaType(mediaType);
  if (!parsed) throw new UnsupportedTypeError();
  if (!parsed.type.verify(body, parsed.ext)) throw new UnsupportedTypeError(`the body is not ${parsed.mediaType}`);
  parsed.type.checkBody(body);
  if (checkFeed(feed) || !isValidId(id)) return null;
  const note = await getNote(feed, id);
  if (!note) return null;
  if (note.type !== parsed.mediaType) throw new UnsupportedTypeError(`this note is ${note.type}: send that Content-Type`);
  return (await storage().replaceNote(feed, id, NOTE_EXTS, body)) ? getNote(feed, id) : null;
}

/** Sets the title and/or alt text of a note; "" removes one. At least one is needed; alt only for types that have it. null: no such note. */
export async function changeMeta(feed: string, id: string, edit: { title?: string; alt?: string }): Promise<Note | null> {
  if (edit.title === undefined && edit.alt === undefined) throw new InvalidBodyError("nothing to change: send title or alt");
  const title = checkLine("title", edit.title, MAX_NOTE_TITLE);
  const alt = checkLine("alt", edit.alt, MAX_ALT);
  if (checkFeed(feed) || !isValidId(id)) return null;
  const note = await getNote(feed, id);
  if (!note) return null;
  if (alt !== undefined && !typeForExt(note.ext)?.hasAlt) throw new InvalidBodyError("alt is for image notes");
  const patch = { ...(title !== undefined && { title }), ...(alt !== undefined && { alt }) };
  return (await storage().updateMeta(feed, id, NOTE_EXTS, patch)) ? getNote(feed, id) : null;
}

export async function removeNote(feed: string, id: string): Promise<boolean> {
  return !checkFeed(feed) && isValidId(id) && (await storage().deleteNote(feed, id, NOTE_EXTS));
}
