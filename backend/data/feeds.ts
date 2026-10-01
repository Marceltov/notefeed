// A feed on disk is a directory `<DATA_DIR>/<feed>/`.
import { readdir } from "node:fs/promises";
import { orMissing, root } from "./fs";

// Directory names only. Dirent.isDirectory() is false for symlinks, so a link can't pull files
// from outside DATA_DIR into a feed.
export async function listFeedDirs(): Promise<string[]> {
  const entries = await orMissing(readdir(/*turbopackIgnore: true*/ root(), { withFileTypes: true }), []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}
