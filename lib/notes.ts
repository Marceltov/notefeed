// All disk access for notes. One note = one `<DATA_DIR>/<feed>/<id>.md` file, byte-for-byte as posted.
import { randomBytes } from "node:crypto";
import { link, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./data";
import { checkFeed } from "./feeds";
import { extractTitle, idStamp, slugify } from "./slug";

export type Note = { id: string; title: string; markdown: string; createdAt: Date };

export const MAX_BYTES = 102400;

export class NoteTooLargeError extends Error {}
export class EmptyNoteError extends Error {}
export class InvalidFeedError extends Error {}

const ID_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[a-z0-9-]+$/;

// DATA_DIR is only known at runtime; turbopackIgnore on the fs calls stops the build from tracing the whole repo.
const feedDir = (feed: string) => join(/*turbopackIgnore: true*/ dataDir(), feed);

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

export async function createNote(feed: string, markdown: string, now = new Date()): Promise<Note> {
  if (checkFeed(feed)) throw new InvalidFeedError(`Invalid feed: ${feed}`);
  if (markdown.trim() === "") throw new EmptyNoteError("Note is empty");
  if (Buffer.byteLength(markdown, "utf8") > MAX_BYTES) throw new NoteTooLargeError("Note exceeds 100 KB");

  const dir = feedDir(feed);
  await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
  const base = `${idStamp(now)}-${slugify(extractTitle(markdown))}`;
  const tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, markdown);
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

async function noteIds(feed: string): Promise<string[]> {
  if (checkFeed(feed)) return [];
  try {
    const files = await readdir(/*turbopackIgnore: true*/ feedDir(feed));
    return files.filter((f) => f.endsWith(".md") && isValidId(f.slice(0, -3))).map((f) => f.slice(0, -3));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

export async function listNotes(feed: string, limit = 50): Promise<Note[]> {
  const ids = (await noteIds(feed)).sort().reverse().slice(0, limit);
  return Promise.all(ids.map(async (id) => toNote(id, await readFile(/*turbopackIgnore: true*/ join(feedDir(feed), `${id}.md`), "utf8"))));
}

export async function countNotes(feed: string): Promise<number> {
  return (await noteIds(feed)).length;
}

export async function feedExists(feed: string): Promise<boolean> {
  if (checkFeed(feed)) return false;
  try {
    return (await stat(/*turbopackIgnore: true*/ feedDir(feed))).isDirectory();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

export async function getNote(feed: string, id: string): Promise<Note | null> {
  if (checkFeed(feed) || !isValidId(id)) return null;
  try {
    return toNote(id, await readFile(/*turbopackIgnore: true*/ join(feedDir(feed), `${id}.md`), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
