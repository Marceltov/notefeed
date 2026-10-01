// A protected feed has `<DATA_DIR>/<feed>/.password` holding the scrypt hash (see backend/feedlock.ts).
// Not a `.md` file, so it never shows up as a note.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { feedDir, isErrno, orMissing, root } from "./fs";

const file = (feed: string) => join(feedDir(feed), ".password");
const tmpName = () => `.${randomBytes(6).toString("hex")}.tmp`;

// Read per request, never cached: deleting the file by hand unlocks the feed at once.
export const readHash = (feed: string): Promise<string | null> =>
  orMissing(readFile(/*turbopackIgnore: true*/ file(feed), "utf8"), null);

// Temp file + rename: a crash leaves either the old hash or the new one.
export async function writeHash(feed: string, hash: string): Promise<void> {
  const tmp = join(feedDir(feed), tmpName());
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, hash);
    await rename(/*turbopackIgnore: true*/ tmp, file(feed));
  } catch (e) {
    await rm(/*turbopackIgnore: true*/ tmp, { force: true });
    throw e;
  }
}

export const removeHash = (feed: string): Promise<void> => rm(/*turbopackIgnore: true*/ file(feed), { force: true });

// The directory appears already holding its hash, so the feed is never open, even briefly.
// rename() onto a pre-existing EMPTY directory succeeds and claims it (intentional: an empty dir is no feed).
// rename() onto a non-empty directory fails, so exactly one of two racers wins; false = lost.
export async function createFeedDirWithHash(feed: string, hash: string): Promise<boolean> {
  await mkdir(/*turbopackIgnore: true*/ root(), { recursive: true });
  const tmp = join(root(), tmpName()); // a leading dot is not a valid feed name, so never listed as a feed
  try {
    await mkdir(/*turbopackIgnore: true*/ tmp);
    await writeFile(/*turbopackIgnore: true*/ join(tmp, ".password"), hash);
    await rename(/*turbopackIgnore: true*/ tmp, feedDir(feed));
    return true;
  } catch (e) {
    await rm(/*turbopackIgnore: true*/ tmp, { recursive: true, force: true });
    if (isErrno(e, "ENOTEMPTY") || isErrno(e, "EEXIST")) return false;
    throw e;
  }
}
