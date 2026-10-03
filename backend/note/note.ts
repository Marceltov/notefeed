// The base of everything a feed lists: one content file plus its metadata (backend/data/notes.ts). A kind of note is a
// subclass and one line in backend/note/types.ts; what is the same for all of them lives here.
import type { Meta } from "../data/notes";

export type NoteInit = { id: string; ext: string; meta: Meta; createdAt: Date; size: number };

export abstract class Note {
  abstract readonly kind: string;
  readonly id: string;
  readonly ext: string;
  readonly meta: Meta;
  readonly createdAt: Date;
  readonly size: number;

  constructor({ id, ext, meta, createdAt, size }: NoteInit) {
    this.id = id;
    this.ext = ext;
    this.meta = meta;
    this.createdAt = createdAt;
    this.size = size;
  }

  get file(): string {
    return `${this.id}.${this.ext}`;
  }
  get sender(): string | undefined {
    return this.meta.sender;
  }
  get tags(): string[] {
    return this.meta.tags ?? [];
  }
  get alt(): string | undefined {
    return this.meta.alt;
  }
  /** What lists and links show: the metadata's title, else what the kind derives from its content; may be empty. */
  /** The text of the note; empty for a kind that has none. */
  abstract readonly markdown: string;
  abstract get title(): string;
  /** The same note with other metadata. */
  abstract withMeta(meta: Meta): Note;

  /** What readers get: the sender only while the feed shows it. */
  forReaders(showSender: boolean): this {
    if (showSender || this.meta.sender === undefined) return this;
    const rest = { ...this.meta };
    delete rest.sender;
    return this.withMeta(rest) as this;
  }
}
