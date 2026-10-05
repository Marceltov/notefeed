// Where a database backend keeps image bytes when they are not in the note's row: a folder (images/fs) or an S3-compatible object
// store (images/s3). Three operations on one object are all a request ever needs, so any store can be put behind it; the row holds the
// key. Listing is for the operator's clean-up alone (sql sweepImages).
import { randomBytes } from "node:crypto";

export interface ImageStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** null when there is no such object. */
  get(key: string): Promise<Buffer | null>;
  /** No error when there is no such object. */
  delete(key: string): Promise<void>;
  /** Every object that is named like a key, in no order, with its size and when it was last written. Anything else in the store is not ours and is left out. */
  list(): AsyncIterable<StoredImage>;
}

export type StoredImage = { key: string; size: number; modified: Date };

// Random, with nothing of the feed or the note in it: the store never learns a feed's name, and a feed made anew cannot meet an old object.
export const newKey = (): string => randomBytes(16).toString("hex");

const KEY_RE = /^[0-9a-f]{32}$/;
export const isKey = (name: string): boolean => KEY_RE.test(name);
/** Keys come from newKey() by way of the database; anything else is refused before it becomes a path or a URL. */
export function assertKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error("image store: not a key");
}
