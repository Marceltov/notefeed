// A feed's settings are `<DATA_DIR>/<feed>/.feed.json`: `{ "title": "...", "description": "...", "image": "<name>" }`, plus
// `"showSender": false` only when false (absent reads as true, so a file without sign-in stays as before). Absent or
// unreadable means empty (a file from before images has no `image`). Not a `.md` file, so never a note.
import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSettings, serializeSettings } from "../settings";
import { FeedGoneError, type Settings } from "../types";
import { feedDir, isErrno, orMissing } from "./fs";

const file = (feed: string) => join(feedDir(feed), ".feed.json");

export async function readSettings(feed: string): Promise<Settings> {
  const text = await orMissing(readFile(/*turbopackIgnore: true*/ file(feed), "utf8"), null);
  return parseSettings(text);
}

// Temp file + rename: a crash leaves the old settings or the new ones. Never creates the directory: a feed
// deleted meanwhile is ENOENT (the caller says 404), not a directory made again.
export async function writeSettings(feed: string, s: Settings): Promise<void> {
  const tmp = join(feedDir(feed), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, serializeSettings(s));
    await rename(/*turbopackIgnore: true*/ tmp, file(feed));
  } catch (e) {
    await rm(/*turbopackIgnore: true*/ tmp, { force: true });
    throw isErrno(e, "ENOENT") ? new FeedGoneError() : e;
  }
}
