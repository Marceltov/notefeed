// Where a database backend keeps image bytes when they are not in the note's row: a folder (images/fs) or an S3-compatible object
// store (images/s3). Three operations on one object, nothing else, so any store can be put behind it. The row holds the key.
import { randomBytes } from "node:crypto";

export interface ImageStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** null when there is no such object. */
  get(key: string): Promise<Buffer | null>;
  /** No error when there is no such object. */
  delete(key: string): Promise<void>;
}

// Random, with nothing of the feed or the note in it: the store never learns a feed's name, and a feed made anew cannot meet an old object.
export const newKey = (): string => randomBytes(16).toString("hex");

const KEY_RE = /^[0-9a-f]{32}$/;
/** Keys come from newKey() by way of the database; anything else is refused before it becomes a path or a URL. */
export function assertKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error("image store: not a key");
}
