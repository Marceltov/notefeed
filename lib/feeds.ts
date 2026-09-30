// Feed names, read ids (HMAC of the feed name) and the server secret behind them.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./data";

export const FEED_RE = /^[a-z0-9_-]{1,64}$/;
export const READ_ID_RE = /^[A-Za-z0-9_-]{22}$/;
// Names that collide with routes. "robots.txt" can't match FEED_RE; listed anyway.
export const RESERVED_FEEDS: ReadonlySet<string> = new Set([
  "r", "api", "login", "logout", "mcp", "n", "_next", "static", "robots.txt", "health",
]);

export function checkFeed(name: string): null | "invalid" | "reserved" {
  if (!FEED_RE.test(name)) return "invalid";
  return RESERVED_FEEDS.has(name) ? "reserved" : null;
}

let cached: Buffer | undefined;
export const resetSecretForTests = () => {
  cached = undefined;
};

// A short key makes read ids computable offline. Fail loudly instead of regenerating the key,
// which would change every read link.
function strong(key: Buffer, where: string): Buffer {
  if (key.length < 32) throw new Error(`${where} must be at least 32 bytes (e.g. openssl rand -hex 32), got ${key.length}`);
  return key;
}

// Sync because readId() is called while rendering; it runs once per process.
function secret(): Buffer {
  if (cached) return cached;
  // An empty NOTEFEED_SECRET (e.g. compose's ${NOTEFEED_SECRET:-}) counts as unset.
  if (process.env.NOTEFEED_SECRET) return (cached = strong(Buffer.from(process.env.NOTEFEED_SECRET), "NOTEFEED_SECRET"));
  // turbopackIgnore on the fs calls stops the build from tracing the whole repo (DATA_DIR is only known at runtime).
  const file = join(/*turbopackIgnore: true*/ dataDir(), ".secret");
  try {
    return (cached = strong(readFileSync(/*turbopackIgnore: true*/ file), file));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  mkdirSync(/*turbopackIgnore: true*/ dataDir(), { recursive: true });
  try {
    const s = randomBytes(32);
    writeFileSync(/*turbopackIgnore: true*/ file, s, { mode: 0o600, flag: "wx" });
    return (cached = s);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    return (cached = strong(readFileSync(/*turbopackIgnore: true*/ file), file)); // another process won the race
  }
}

export function readId(feed: string): string {
  return createHmac("sha256", secret()).update(feed).digest("base64url").slice(0, 22);
}

export async function listFeeds(): Promise<string[]> {
  try {
    const entries = await readdir(/*turbopackIgnore: true*/ dataDir(), { withFileTypes: true });
    // Dirent.isDirectory() is false for symlinks, so a link can't pull files from outside DATA_DIR into a feed.
    return entries.filter((e) => e.isDirectory() && checkFeed(e.name) === null).map((e) => e.name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

export async function feedForReadId(id: string): Promise<string | null> {
  if (!READ_ID_RE.test(id)) return null;
  const want = Buffer.from(id);
  let found: string | null = null;
  for (const feed of await listFeeds()) {
    // No early exit: keep the work independent of which feed matched.
    if (timingSafeEqual(Buffer.from(readId(feed)), want)) found = feed;
  }
  return found;
}
