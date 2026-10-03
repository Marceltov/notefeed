// The kinds of note, by file extension: listing and reading look here, so a new kind is a subclass of Note and one
// entry in NOTE_TYPES.
import { IMAGE_EXTS, sniffImage } from "../images";
import { ImageNote } from "./image";
import { MarkdownNote } from "./markdown";
import { parseMedia } from "./media";
import type { Note, NoteInit } from "./note";

export { ACCEPTED_TYPES, mediaTypeOf } from "./media";

export type NoteType = {
  /** Internal name: the caps and listings tell the types apart by it. */
  name: string;
  exts: readonly string[];
  /** Whether a body is what was declared for `ext`: an image has its format's signature, markdown is valid UTF-8. */
  verify(bytes: Uint8Array, ext: string): boolean;
  /** Whether `read` needs the file's bytes: listing a picture does not. */
  needsContent: boolean;
  /** Builds the note from what is on disk. */
  read(init: NoteInit, content: Buffer): Note;
};

function validUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const markdown: NoteType = { name: "markdown", exts: ["md"], verify: validUtf8, needsContent: true, read: (init, content) => new MarkdownNote(init, content.toString("utf8")) };
const image: NoteType = { name: "image", exts: IMAGE_EXTS, verify: (bytes, ext) => sniffImage(bytes) === ext, needsContent: false, read: (init) => new ImageNote(init) };

export const NOTE_TYPES: readonly NoteType[] = [markdown, image];

export const typeForExt = (ext: string): NoteType | undefined => NOTE_TYPES.find((t) => t.exts.includes(ext));

/** A `Content-Type` header as one of the registry's types with its extension, or null (see `parseMedia`). */
export function parseMediaType(header: string | null): { type: NoteType; ext: string; mediaType: string } | null {
  const media = parseMedia(header);
  const type = media && typeForExt(media.ext);
  return media && type ? { type, ...media } : null;
}
