// A feed on disk is a directory `<DATA_DIR>/<feed>/`.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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

// The one way a feed directory is made: a temp directory under DATA_DIR holding `.readid` (and `.password`
// for a protected feed) is renamed into place, so the feed appears complete or not at all and is never open
// or without its read id, even if a write fails or the process dies. A leading dot is not a valid feed name,
// so the temp directory is never listed as a feed.
// rename() onto a pre-existing EMPTY directory succeeds and claims it (intentional: an empty dir is no feed).
// rename() onto a non-empty directory fails, so exactly one of two racers wins; false = the feed exists.
export async function createFeedDir(feed: string, readId: string, hash?: string): Promise<boolean> {
  await mkdir(/*turbopackIgnore: true*/ root(), { recursive: true });
  const tmp = join(root(), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await mkdir(/*turbopackIgnore: true*/ tmp);
    if (hash !== undefined) await writeFile(/*turbopackIgnore: true*/ join(tmp, ".password"), hash);
    await writeFile(/*turbopackIgnore: true*/ join(tmp, ".readid"), readId);
    await rename(/*turbopackIgnore: true*/ tmp, feedDir(feed));
    return true;
  } catch (e) {
    await rm(/*turbopackIgnore: true*/ tmp, { recursive: true, force: true });
    if (isErrno(e, "ENOTEMPTY") || isErrno(e, "EEXIST")) return false;
    throw e;
  }
}

// Delete in two steps: the rename takes the feed away in one syscall (it is never half-deleted from a
// reader's point of view), then the files go. A leading dot is no valid feed name, so a leftover is never
// listed as a feed. false = there was no such directory.
const DELETED = ".deleted-";
const LEFTOVER_RE = /^\.deleted-[0-9a-f]{12}$/;
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

// A crash between the rename and the removal. Called once, when the index loads. One that can't be
// removed is logged (no names) and skipped: it must not keep every request from being served.
export async function removeDeletedLeftovers(): Promise<void> {
  const entries = await orMissing(readdir(/*turbopackIgnore: true*/ root(), { withFileTypes: true }), []);
  for (const e of entries) {
    if (!e.isDirectory() || !LEFTOVER_RE.test(e.name)) continue;
    await rm(/*turbopackIgnore: true*/ join(root(), e.name), { recursive: true, force: true }).catch((err) =>
      console.error("could not remove a deleted feed's leftover files; will retry at the next start", (err as NodeJS.ErrnoException).code),
    );
  }
}
