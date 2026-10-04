// The base of everything a feed lists: one content file plus its metadata (backend/data/notes.ts). A kind of note is a
// subclass and one line in backend/note/types.ts; what is the same for all of them lives here.
import { cleanLine } from "../../shared/links";
import type { Meta } from "../storage/types";
import { mediaTypeOf } from "./media";

/** What a note adds to its RSS item: raw markdown as the description, or a file as the enclosure (RSS 2.0 allows one per item). */
export type RssContent = { description?: string; enclosure?: { url: string; length: number; type: string } };

export type NoteInit = { id: string; ext: string; meta: Meta; createdAt: Date; size: number };

export abstract class Note {
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

  /** The media type of the note's file, as it was posted. */
  get type(): string {
    return mediaTypeOf(this.ext);
  }
  get file(): string {
    return `${this.id}.${this.ext}`;
  }
  get sender(): string | undefined {
    return this.meta.sender === undefined ? undefined : cleanLine(this.meta.sender); // stored before the rule, or edited by hand
  }
  get tags(): string[] {
    return this.meta.tags ?? [];
  }
  get alt(): string | undefined {
    return this.meta.alt === undefined ? undefined : cleanLine(this.meta.alt);
  }
  /** The text of a text type; undefined for a binary file. */
  abstract get content(): string | undefined;
  /** What lists and links show: the metadata's title, else what the type derives from its content; may be empty. */
  abstract get title(): string;
  /** `base` is the read link the feed's files are served under (no trailing slash). */
  abstract rssContent(base: string): RssContent;
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
