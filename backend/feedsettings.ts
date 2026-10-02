// A feed's display title and description: validation and storage. Access and rate limits are posting.ts.
import { readSettings, writeSettings } from "./data/settings";
import { isErrno } from "./data/fs";
import { InvalidBodyError, NotFoundError } from "./errors";
import { knownImage } from "./images";
import type { Note } from "./notes";

export type FeedSettings = { title: string; description: string; image: string; showSender: boolean };

export const MAX_TITLE = 100;
export const MAX_DESCRIPTION = 500;

// Trimmed; counted in characters (an emoji is one), no control characters, so one line of text.
function field(input: Record<string, unknown>, name: "title" | "description", max: number): string {
  const v = input[name];
  if (typeof v !== "string") throw new InvalidBodyError(`${name} must be a string`);
  const s = v.trim();
  if (/[\x00-\x1f\x7f]/.test(s)) throw new InvalidBodyError(`${name} must not contain control characters`);
  if ([...s].length > max) throw new InvalidBodyError(`${name} must be at most ${max} characters`);
  return s;
}

// `image` and `showSender` absent (undefined, or null from a form without the field) mean "unchanged": the caller fills them in.
export function checkSettings(input: unknown): Omit<FeedSettings, "image" | "showSender"> & { image?: string; showSender?: boolean } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new InvalidBodyError('JSON needs "title" and "description" strings');
  const o = input as Record<string, unknown>;
  const image = o.image ?? undefined;
  if (image !== undefined && typeof image !== "string") throw new InvalidBodyError("image must be a string");
  const showSender = o.showSender ?? undefined;
  if (showSender !== undefined && typeof showSender !== "boolean") throw new InvalidBodyError("show_sender must be a boolean");
  return { title: field(o, "title", MAX_TITLE), description: field(o, "description", MAX_DESCRIPTION), image, showSender };
}

// What readers (RSS, the read API and pages) get: the sender only while the feed shows it.
export const forReaders = (notes: Note[], s: { showSender: boolean }): Note[] => (s.showSender ? notes : notes.map((n) => Object.fromEntries(Object.entries(n).filter(([k]) => k !== "sender")) as Note));

// What is stored, whatever has become of the image file (the save path in posting.ts keeps it as it is).
export const getStoredSettings = (feed: string): Promise<FeedSettings> => readSettings(feed);

// What is shown: a title image whose file is gone (removed by hand) counts as none, so nothing points at a 404.
export async function getSettings(feed: string): Promise<FeedSettings> {
  const s = await readSettings(feed);
  return s.image && !(await knownImage(feed, s.image)) ? { ...s, image: "" } : s;
}

export async function saveSettings(feed: string, s: FeedSettings): Promise<void> {
  try {
    await writeSettings(feed, s);
  } catch (e) {
    if (isErrno(e, "ENOENT")) throw new NotFoundError("no such feed");
    throw e;
  }
}
