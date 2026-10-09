// The operator's takedown (issue #155): a feed named by a read link, a read id or an image URL stops being served at once, its notes
// and image bytes go, a tombstone keeps its name and read id from ever being used again, and the hashes of its images go on the
// instance's blocklist, so the same bytes are refused in any feed (posting.ts checks). Nothing about anyone is written; the log
// line says what went, never the feed (ADR 0015).
import { createHash } from "node:crypto";
import { InvalidRequestError, NotFoundError } from "./errors";
import { feedForReadId, isRemovedReadId, isReadId } from "./feeds";
import { logger } from "./log";
import { countNotes, listNotes } from "./notes";
import { storage } from "./storage";

const log = logger("takedown");

export const imageHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** The read id in a read link (`/r/<id>`, `/r/<id>/feed.xml`), an image URL (`/r/<id>/<file>`) or a note's read URL; a bare read id as it is. */
export function readIdOfTarget(target: string): string | null {
  const t = target.trim();
  if (isReadId(t)) return t;
  let path = t;
  if (/^https?:\/\//i.test(t)) {
    if (!URL.canParse(t)) return null;
    path = new URL(t).pathname;
  }
  const m = /^\/r\/([^/]+)(?:\/|$)/.exec(path);
  const id = m && decodeURIComponent(m[1]);
  return id && isReadId(id) ? id : null;
}

export type Takedown = { removed: boolean; already_removed: boolean; notes: number; images: number; blocked: number; image_keys: string[] };

export async function takedown(target: string): Promise<Takedown> {
  const readId = readIdOfTarget(target);
  if (!readId) throw new InvalidRequestError("give a read link, a read id or an image URL");
  const feed = await feedForReadId(readId);
  if (!feed) {
    if (await isRemovedReadId(readId)) return { removed: false, already_removed: true, notes: 0, images: 0, blocked: 0, image_keys: [] };
    throw new NotFoundError("no feed has this read id");
  }
  // The hashes before the bytes go. A feed is at most NOTEFEED_MAX_NOTES_PER_FEED; here there is no cap, and the images are read one at a time.
  const hashes = new Set<string>();
  for (const note of await listNotes(feed, Number.MAX_SAFE_INTEGER, undefined, undefined, "image")) {
    const bytes = await storage().readFile(feed, note.file);
    if (bytes) hashes.add(imageHash(bytes));
  }
  const notes = await countNotes(feed);
  const images = await countNotes(feed, "image");
  const { removed, keys } = await storage().takedownFeed(feed, readId);
  await storage().blockImages([...hashes]);
  log.info({ notes, images, blocked: hashes.size, keys: keys.length }, "feed removed by the operator");
  return { removed, already_removed: false, notes, images, blocked: hashes.size, image_keys: keys };
}

/** Whether these image bytes are on the blocklist. */
export async function isBlockedImage(bytes: Uint8Array): Promise<boolean> {
  return storage().isBlockedImage(imageHash(bytes));
}
