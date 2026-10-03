import { extractTitle } from "../../shared/notes";
import type { Meta } from "../data/notes";
import { Note, type NoteInit } from "./note";

export class MarkdownNote extends Note {
  readonly kind = "markdown";
  readonly markdown: string;

  constructor(init: NoteInit, markdown: string) {
    super(init);
    this.markdown = markdown;
  }

  get title(): string {
    return this.meta.title ?? extractTitle(this.markdown);
  }
  withMeta(meta: Meta): MarkdownNote {
    return new MarkdownNote({ id: this.id, ext: this.ext, meta, createdAt: this.createdAt, size: this.size }, this.markdown);
  }
}
