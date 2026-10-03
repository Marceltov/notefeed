import type { Meta } from "../data/notes";
import { Note, type NoteInit } from "./note";

// A standalone image: the content file is the picture, everything else is in the sidecar.
export class ImageNote extends Note {
  get content(): undefined {
    return undefined;
  }

  get title(): string {
    return this.meta.title ?? "";
  }
  /** The file name it was posted with, if it had one. */
  get name(): string | undefined {
    return this.meta.name;
  }
  rssContent(base: string) {
    return { enclosure: { url: `${base}/${this.file}`, length: this.size, type: this.type } };
  }
  withMeta(meta: Meta): ImageNote {
    return new ImageNote({ id: this.id, ext: this.ext, meta, createdAt: this.createdAt, size: this.size } satisfies NoteInit);
  }
}
