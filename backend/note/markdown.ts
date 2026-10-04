import { absolutizeImages, cleanLine } from "../../shared/links";
import { extractTitle } from "../../shared/notes";
import type { Meta } from "../storage/types";
import { EmptyNoteError, NoteTooLargeError } from "../errors";
import { Note, type NoteInit } from "./note";

export const MAX_BYTES = 102400;

// Storage only: no auth, rate limit or caps (that is posting.ts).
export function checkMarkdown(markdown: string): void {
  if (markdown.trim() === "") throw new EmptyNoteError();
  if (Buffer.byteLength(markdown, "utf8") > MAX_BYTES) throw new NoteTooLargeError();
}

export class MarkdownNote extends Note {
  readonly markdown: string;

  constructor(init: NoteInit, markdown: string) {
    super(init);
    this.markdown = markdown;
  }

  get content(): string {
    return this.markdown;
  }
  get title(): string {
    return cleanLine(this.meta.title ?? extractTitle(this.markdown)); // what no title holds is not shown, whatever was stored or written in the text
  }
  // Readers have no base to resolve a relative image link against, so it becomes absolute here; the stored note is unchanged.
  rssContent(base: string) {
    return { description: absolutizeImages(this.markdown, `${base}/`) };
  }
  withMeta(meta: Meta): MarkdownNote {
    return new MarkdownNote({ id: this.id, ext: this.ext, meta, createdAt: this.createdAt, size: this.size }, this.markdown);
  }
}
