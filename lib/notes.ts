// All disk access for notes. One note = one `<DATA_DIR>/<id>.md` file, byte-for-byte as posted.
import { randomBytes } from "node:crypto";
import { link, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractTitle, idStamp, slugify } from "./slug";

export type Note = { id: string; title: string; markdown: string; createdAt: Date };

export const MAX_BYTES = 102400;

export class NoteTooLargeError extends Error {}
export class EmptyNoteError extends Error {}

const ID_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[a-z0-9-]+$/;

// DATA_DIR is only known at runtime; turbopackIgnore stops the build from tracing the whole repo.
const dataDir = () => process.env.DATA_DIR || "/data";

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

function toNote(id: string, markdown: string): Note {
  const [, y, mo, d, h, mi, s] = ID_RE.exec(id)!;
  return {
    id,
    title: extractTitle(markdown),
    markdown,
    createdAt: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)),
  };
}

export async function createNote(markdown: string, now = new Date()): Promise<Note> {
  if (markdown.trim() === "") throw new EmptyNoteError("Note is empty");
  if (Buffer.byteLength(markdown, "utf8") > MAX_BYTES) throw new NoteTooLargeError("Note exceeds 100 KB");

  const dir = dataDir();
  await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
  const base = `${idStamp(now)}-${slugify(extractTitle(markdown))}`;
  const tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(/*turbopackIgnore: true*/ tmp, markdown);
  try {
    // link() fails with EEXIST instead of overwriting, so the final name appears atomically and exclusively.
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      try {
        await link(/*turbopackIgnore: true*/ tmp, join(dir, `${id}.md`));
        return toNote(id, markdown);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
  } finally {
    await unlink(/*turbopackIgnore: true*/ tmp).catch(() => {});
  }
}

export async function listNotes(limit = 50): Promise<Note[]> {
  let files: string[];
  try {
    files = await readdir(/*turbopackIgnore: true*/ dataDir());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const ids = files
    .filter((f) => f.endsWith(".md") && isValidId(f.slice(0, -3)))
    .map((f) => f.slice(0, -3))
    .sort()
    .reverse()
    .slice(0, limit);
  return Promise.all(ids.map(async (id) => toNote(id, await readFile(/*turbopackIgnore: true*/ join(dataDir(), `${id}.md`), "utf8"))));
}

export async function getNote(id: string): Promise<Note | null> {
  if (!isValidId(id)) return null;
  try {
    return toNote(id, await readFile(/*turbopackIgnore: true*/ join(dataDir(), `${id}.md`), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
