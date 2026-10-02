// A feed's settings are `<DATA_DIR>/<feed>/.feed.json`: `{ "title": "...", "description": "...", "image": "<name>" }`, plus
// `"showSender": false` only when false (absent reads as true, so a file without sign-in stays as before). Absent or
// unreadable means empty (a file from before images has no `image`). Not a `.md` file, so never a note.
import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { feedDir, orMissing } from "./fs";

export type Settings = { title: string; description: string; image: string; showSender: boolean };

const file = (feed: string) => join(feedDir(feed), ".feed.json");

export async function readSettings(feed: string): Promise<Settings> {
  const text = await orMissing(readFile(/*turbopackIgnore: true*/ file(feed), "utf8"), null);
  try {
    const j = JSON.parse(text ?? "");
    return { title: typeof j.title === "string" ? j.title : "", description: typeof j.description === "string" ? j.description : "", image: typeof j.image === "string" ? j.image : "", showSender: j.showSender !== false };
  } catch {
    return { title: "", description: "", image: "", showSender: true };
  }
}

// Temp file + rename: a crash leaves the old settings or the new ones. Never creates the directory: a feed
// deleted meanwhile is ENOENT (the caller says 404), not a directory made again.
export async function writeSettings(feed: string, s: Settings): Promise<void> {
  const tmp = join(feedDir(feed), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const { showSender, ...rest } = s;
    await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(showSender ? rest : s));
    await rename(/*turbopackIgnore: true*/ tmp, file(feed));
  } catch (e) {
    await rm(/*turbopackIgnore: true*/ tmp, { force: true });
    throw e;
  }
}
