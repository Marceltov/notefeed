// A note on disk is `<DATA_DIR>/<feed>/<id>.md`, byte-for-byte as posted.
import { randomBytes } from "node:crypto";
import { link, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { feedDir, isErrno, orMissing } from "./fs";

const file = (feed: string, id: string) => join(feedDir(feed), `${id}.md`);

// Stores `markdown` as `<base>.md`, or `<base>-2.md`, `-3`, … if taken; returns the id used.
// The feed directory must exist (ensureFeed creates it): a feed deleted meanwhile is ENOENT here, never
// a directory made again without its `.readid`. Never overwrites, never leaves a partial file behind.
export async function writeNote(feed: string, base: string, markdown: string): Promise<string> {
  const dir = feedDir(feed);
  const tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, markdown);
    // link() fails with EEXIST instead of overwriting, so the final name appears atomically and exclusively.
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      try {
        await link(/*turbopackIgnore: true*/ tmp, file(feed, id));
        return id;
      } catch (e) {
        if (!isErrno(e, "EEXIST")) throw e;
      }
    }
  } finally {
    await unlink(/*turbopackIgnore: true*/ tmp).catch(() => {});
  }
}

export function readNote(feed: string, id: string): Promise<string | null> {
  return orMissing(readFile(/*turbopackIgnore: true*/ file(feed, id), "utf8"), null);
}

// Every `*.md` name in the feed, without the extension; the caller filters for valid ids.
export async function listNoteFiles(feed: string): Promise<string[]> {
  const files = await orMissing(readdir(/*turbopackIgnore: true*/ feedDir(feed)), []);
  return files.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
}

// Replaces an existing note's content atomically (temp file, then rename over it); false, and nothing
// created, when there is no such note. ponytail: a delete landing between the stat and the rename
// brings the note back with the edit; a per-feed lock would close it.
export async function replaceNote(feed: string, id: string, markdown: string): Promise<boolean> {
  if (!(await orMissing(stat(/*turbopackIgnore: true*/ file(feed, id)).then(() => true), false))) return false;
  const tmp = join(feedDir(feed), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, markdown);
    await rename(/*turbopackIgnore: true*/ tmp, file(feed, id));
    return true;
  } catch (e) {
    if (isErrno(e, "ENOENT")) return false; // the feed was deleted since the stat
    throw e;
  } finally {
    await unlink(/*turbopackIgnore: true*/ tmp).catch(() => {});
  }
}

export function deleteNoteFile(feed: string, id: string): Promise<boolean> {
  return orMissing(unlink(/*turbopackIgnore: true*/ file(feed, id)).then(() => true), false);
}
