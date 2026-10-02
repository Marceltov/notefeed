// A feed's display title and description: validation and storage. Access and rate limits are posting.ts.
import { readSettings, writeSettings } from "./data/settings";
import { isErrno } from "./data/fs";
import { InvalidBodyError, NotFoundError } from "./errors";

export type FeedSettings = { title: string; description: string; image: string };

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

// `image` absent (undefined, or null from a form without the field) means "unchanged": the caller fills it in.
export function checkSettings(input: unknown): Omit<FeedSettings, "image"> & { image?: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new InvalidBodyError('JSON needs "title" and "description" strings');
  const o = input as Record<string, unknown>;
  const image = o.image ?? undefined;
  if (image !== undefined && typeof image !== "string") throw new InvalidBodyError("image must be a string");
  return { title: field(o, "title", MAX_TITLE), description: field(o, "description", MAX_DESCRIPTION), image };
}

export const getSettings = (feed: string): Promise<FeedSettings> => readSettings(feed);

export async function saveSettings(feed: string, s: FeedSettings): Promise<void> {
  try {
    await writeSettings(feed, s);
  } catch (e) {
    if (isErrno(e, "ENOENT")) throw new NotFoundError("no such feed");
    throw e;
  }
}
