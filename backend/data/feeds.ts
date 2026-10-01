// A feed on disk is a directory `<DATA_DIR>/<feed>/`.
import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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
  await mkdir(/*turbopackIgnore: true*/ feedDir(feed), { recursive: true });
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

// Delete in two steps: the rename takes the feed away in one syscall (it is never half-deleted from a
// reader's point of view), then the files go. A leading dot is no valid feed name, so a leftover is never
// listed as a feed. false = there was no such directory.
const DELETED = ".deleted-";
export async function deleteFeedDir(feed: string): Promise<boolean> {
  const gone = join(root(), `${DELETED}${randomBytes(6).toString("hex")}`);
  try {
    await rename(/*turbopackIgnore: true*/ feedDir(feed), gone);
  } catch (e) {
    if (isErrno(e, "ENOENT")) return false;
    throw e;
  }
  // The feed is gone either way; a failure here leaves a leftover the next start removes.
  await rm(/*turbopackIgnore: true*/ gone, { recursive: true, force: true }).catch((e) => console.error("could not remove a deleted feed's files; they go at the next start", e));
  return true;
}

// A crash between the rename and the removal. Called once, when the index loads.
export async function removeDeletedLeftovers(): Promise<void> {
  const entries = await orMissing(readdir(/*turbopackIgnore: true*/ root(), { withFileTypes: true }), []);
  for (const e of entries) {
    if (e.isDirectory() && e.name.startsWith(DELETED)) await rm(/*turbopackIgnore: true*/ join(root(), e.name), { recursive: true, force: true });
  }
}
