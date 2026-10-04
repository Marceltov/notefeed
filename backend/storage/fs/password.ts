// A protected feed has `<DATA_DIR>/<feed>/.password` holding the scrypt hash (see backend/feedlock.ts).
// Not a `.md` file, so it never shows up as a note.
import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FeedGoneError } from "../types";
import { feedDir, isErrno, orMissing } from "./fs";

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
    throw isErrno(e, "ENOENT") ? new FeedGoneError() : e;
  }
}

export const removeHash = (feed: string): Promise<void> => rm(/*turbopackIgnore: true*/ file(feed), { force: true });
