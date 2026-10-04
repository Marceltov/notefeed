// A feed's display title and description: validation and storage. Access and rate limits are posting.ts.
import { cleanLine, FORBIDDEN_IN_TEXT } from "../shared/links";
import { InvalidBodyError, NotFoundError } from "./errors";
import { hasImageNote, type Note } from "./notes";
import { storage } from "./storage";
import { FeedGoneError } from "./storage/types";

export type FeedSettings = { title: string; description: string; image: string; showSender: boolean };

export const MAX_TITLE = 100;
export const MAX_DESCRIPTION = 500;

// Trimmed; counted in characters (an emoji is one), one line of text: no control or text-direction override characters (the rule of a note's title).
function field(input: Record<string, unknown>, name: "title" | "description", max: number): string {
  const v = input[name];
  if (typeof v !== "string") throw new InvalidBodyError(`${name} must be a string`);
  const s = v.trim();
  if (FORBIDDEN_IN_TEXT.test(s)) throw new InvalidBodyError(`${name} must be one line, without control or text-direction override characters`);
  if ([...s].length > max) throw new InvalidBodyError(`${name} must be at most ${max} characters`);
  return s;
}

// `image` and `showSender` absent (undefined, or null from a form without the field) mean "unchanged": the caller fills them in.
// `readId` absent (or null, from a form without the field) leaves the read id as it is; "" asks for a new random one.
// posting.ts checks it against the other feeds.
export function checkSettings(input: unknown): Omit<FeedSettings, "image" | "showSender"> & { image?: string; showSender?: boolean; readId?: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new InvalidBodyError('JSON needs "title" and "description" strings');
  const o = input as Record<string, unknown>;
  const image = o.image ?? undefined;
  if (image !== undefined && typeof image !== "string") throw new InvalidBodyError("image must be a string");
  const showSender = o.showSender ?? undefined;
  if (showSender !== undefined && typeof showSender !== "boolean") throw new InvalidBodyError("show_sender must be a boolean");
  const readId = o.readId ?? undefined;
  if (readId !== undefined && typeof readId !== "string") throw new InvalidBodyError("read_id must be a string");
  return { title: field(o, "title", MAX_TITLE), description: field(o, "description", MAX_DESCRIPTION), image, showSender, readId: readId?.trim() };
}

// What readers (RSS, the read API and pages) get: the sender only while the feed shows it.
export const forReaders = (notes: Note[], s: { showSender: boolean }): Note[] => notes.map((n) => n.forReaders(s.showSender));

// What is stored, whatever has become of the image file (the save path in posting.ts keeps it as it is).
export const getStoredSettings = (feed: string): Promise<FeedSettings> => storage().readSettings(feed);

// What is shown: a title image whose file is gone (removed by hand) counts as none, so nothing points at a 404.
export async function getSettings(feed: string): Promise<FeedSettings> {
  const stored = await storage().readSettings(feed);
  const s = { ...stored, title: cleanLine(stored.title), description: cleanLine(stored.description) }; // stored before the rule, or edited by hand
  return s.image && !(await hasImageNote(feed, s.image)) ? { ...s, image: "" } : s;
}

export async function saveSettings(feed: string, s: FeedSettings): Promise<void> {
  try {
    await storage().writeSettings(feed, s);
  } catch (e) {
    if (e instanceof FeedGoneError) throw new NotFoundError("no such feed");
    throw e;
  }
}
