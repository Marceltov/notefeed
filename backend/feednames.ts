// The rules for the names a feed goes by: feed names, read ids, and the names kept back. No storage in here, so the storage
// backends can use them.
import { config } from "./config";
import { InvalidFeedError, ReservedFeedError } from "./errors";

export const FEED_RE = /^[a-z0-9_-]{1,64}$/;
export const READ_ID_RE = /^[A-Za-z0-9_-]{3,64}$/; // random ones are 22 characters
export const CUSTOM_READ_ID_RE = /^[a-z0-9_-]{3,64}$/; // the ones people choose
// Names that collide with routes. "robots.txt" can't match FEED_RE; listed anyway.
export const RESERVED_FEEDS: ReadonlySet<string> = new Set([
  "r", "api", "login", "logout", "mcp", "metrics", "oauth", "n", "_next", "static", "robots.txt", "health",
  // The operator's pages (legal.ts). Kept back also where no file is set: the routes are there either way.
  "imprint", "privacy",
]);

export function checkFeed(name: string): null | "invalid" | "reserved" {
  if (!FEED_RE.test(name)) return "invalid";
  return RESERVED_FEEDS.has(name) ? "reserved" : null;
}

export function assertFeed(name: string): void {
  const bad = checkFeed(name);
  if (bad === "invalid") throw new InvalidFeedError();
  if (bad === "reserved") throw new ReservedFeedError();
}

// Names kept for the operator (announcements and the like), only those in NOTEFEED_RESERVED_FEEDS. Unlike RESERVED_FEEDS
// they collide with no route, so they only stop a feed from being CREATED by a post: a feed that already has such
// a name keeps working. With NOTEFEED_RESERVED_PASSWORD set, feeds.ts creates each one protected by that password
// and with its own name as read id, so /r/news is the read link for good (announcements are public by intent: no
// obfuscation, even if the feed is deleted and made again). Without the password they simply don't exist.
export const heldBack = () => config.reservedFeeds().filter((n) => checkFeed(n) === null);
export const isHeldBack = (name: string) => heldBack().includes(name);
// A read id is 3 to 64 characters (22 random ones, or a chosen one), or the name of a reserved feed (its read id is its name).
export const isReadId = (id: string) => READ_ID_RE.test(id) || isHeldBack(id);
