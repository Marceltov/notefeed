// The kinds of note, by file extension: listing and reading look here, so a new kind is a subclass of Note and one
// entry in NOTE_TYPES.
import { IMAGE_EXTS } from "../images";
import { ImageNote } from "./image";
import { MarkdownNote } from "./markdown";
import type { Note, NoteInit } from "./note";

export type NoteType = {
  kind: string;
  exts: readonly string[];
  /** Builds the note from what is on disk. */
  read(init: NoteInit, content: Buffer): Note;
};

const markdown: NoteType = { kind: "markdown", exts: ["md"], read: (init, content) => new MarkdownNote(init, content.toString("utf8")) };
const image: NoteType = { kind: "image", exts: IMAGE_EXTS, read: (init) => new ImageNote(init) };

export const NOTE_TYPES: readonly NoteType[] = [markdown, image];

export const typeForExt = (ext: string): NoteType | undefined => NOTE_TYPES.find((t) => t.exts.includes(ext));
