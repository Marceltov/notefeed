// An image on disk is `<DATA_DIR>/<feed>/.images/<name>`, byte-for-byte as uploaded. Callers pass a name already
// checked against IMAGE_FILE_RE (backend/images.ts); nothing here validates it. Never creates the feed directory.
import { randomBytes } from "node:crypto";
import { link, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { feedDir, isErrno, orMissing } from "./fs";

const dir = (feed: string) => join(feedDir(feed), ".images");
const file = (feed: string, name: string) => join(dir(feed), name);

// The feed directory must exist: a feed deleted meanwhile is ENOENT here (mkdir is not recursive), never
// a directory made again. An existing file is success: the name is the content's hash.
export async function writeImage(feed: string, name: string, bytes: Uint8Array): Promise<void> {
  try {
    await mkdir(/*turbopackIgnore: true*/ dir(feed));
  } catch (e) {
    if (!isErrno(e, "EEXIST")) throw e;
  }
  const tmp = join(dir(feed), `.${randomBytes(6).toString("hex")}.tmp`);
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

// Counts names that don't start with a dot, so a temp file in flight is not an image.
export async function countImages(feed: string): Promise<number> {
  return (await orMissing(readdir(/*turbopackIgnore: true*/ dir(feed)), [])).filter((n) => !n.startsWith(".")).length;
}

export const hasImage = (feed: string, name: string): Promise<boolean> =>
  orMissing(stat(/*turbopackIgnore: true*/ file(feed, name)).then((s) => s.isFile()), false);
