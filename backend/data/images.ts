// An image on disk is `<DATA_DIR>/<feed>/<name>`, next to the notes, byte-for-byte as uploaded. Callers pass a name already
// checked against IMAGE_FILE_RE (shared/images.ts); nothing here validates it. Never creates the feed directory.
import { randomBytes } from "node:crypto";
import { link, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { feedDir, isErrno, orMissing } from "./fs";

const file = (feed: string, name: string) => join(feedDir(feed), name);

// The feed directory must exist: a feed deleted meanwhile is ENOENT here, never a directory made again.
// An existing file is success: the name is the content's hash.
export async function writeImage(feed: string, name: string, bytes: Uint8Array): Promise<void> {
  const tmp = join(feedDir(feed), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, bytes);
    await link(/*turbopackIgnore: true*/ tmp, file(feed, name));
  } catch (e) {
    if (!isErrno(e, "EEXIST")) throw e;
  } finally {
    await unlink(/*turbopackIgnore: true*/ tmp).catch(() => {});
  }
}

export const readImageFile = (feed: string, name: string): Promise<Uint8Array | null> =>
  orMissing(readFile(/*turbopackIgnore: true*/ file(feed, name)), null);

// The feed directory also holds notes and dot files, so the caller says which names are images.
export async function countImages(feed: string, isImage: (name: string) => boolean): Promise<number> {
  return (await orMissing(readdir(/*turbopackIgnore: true*/ feedDir(feed)), [])).filter(isImage).length;
}

export const hasImage = (feed: string, name: string): Promise<boolean> =>
  orMissing(stat(/*turbopackIgnore: true*/ file(feed, name)).then((s) => s.isFile()), false);
