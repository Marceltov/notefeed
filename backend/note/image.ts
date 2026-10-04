import { cleanLine, cleanName } from "../../shared/links";
import type { Meta } from "../data/notes";
import { Note, type NoteInit } from "./note";

// A standalone image: the content file is the picture, everything else is in the sidecar.
export class ImageNote extends Note {
  get content(): undefined {
    return undefined;
  }

  get title(): string {
    return cleanLine(this.meta.title ?? "");
  }
  /** The file name it was posted with, if it had one, as it may be shown. */
  get name(): string | undefined {
    return cleanName(this.meta.name); // a name stored before the rule may hold what it forbids
  }
  rssContent(base: string) {
    return { enclosure: { url: `${base}/${this.file}`, length: this.size, type: this.type } };
  }
  withMeta(meta: Meta): ImageNote {
    return new ImageNote({ id: this.id, ext: this.ext, meta, createdAt: this.createdAt, size: this.size } satisfies NoteInit);
  }
}
