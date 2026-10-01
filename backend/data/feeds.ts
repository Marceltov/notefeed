// A feed on disk is a directory `<DATA_DIR>/<feed>/`.
import { randomBytes } from "node:crypto";
import { link, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { feedDir, isErrno, orMissing, root } from "./fs";

// Directory names only. Dirent.isDirectory() is false for symlinks, so a link can't pull files
// from outside DATA_DIR into a feed.
export async function listFeedDirs(): Promise<string[]> {
  const entries = await orMissing(readdir(/*turbopackIgnore: true*/ root(), { withFileTypes: true }), []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

// A feed created after per-feed read ids has `.readid` (a random id); older feeds have none and keep
// the id derived from their name. Not a `.md` file, so it never shows up as a note.
const readIdFile = (feed: string) => join(feedDir(feed), ".readid");

export const readReadId = async (feed: string): Promise<string | null> =>
  (await orMissing(readFile(/*turbopackIgnore: true*/ readIdFile(feed), "utf8"), null))?.trim() ?? null;

// Exclusive create: a temp file is hard-linked into place, so the file appears complete or not at all and
// exactly one of two racers wins. false = `.readid` already exists.
export async function writeReadId(feed: string, id: string): Promise<boolean> {
  const tmp = join(feedDir(feed), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, id);
    await link(/*turbopackIgnore: true*/ tmp, readIdFile(feed));
    return true;
  } catch (e) {
    if (isErrno(e, "EEXIST")) return false;
    throw e;
  } finally {
    await rm(/*turbopackIgnore: true*/ tmp, { force: true });
  }
}
