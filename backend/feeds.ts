// Feeds: name rules, read ids (HMAC of the name with the server secret) and the in-memory index of
// existing feeds, which answers "does it exist", "how many" and "which feed has this read id" in O(1).
import { createHmac } from "node:crypto";
import { config } from "./config";
import { listFeedDirs } from "./data/feeds";
import { loadOrCreateSecret, secretPath } from "./data/secret";
import { InvalidFeedError, ReservedFeedError } from "./errors";
import { processState } from "./state";

export const FEED_RE = /^[a-z0-9_-]{1,64}$/;
export const READ_ID_RE = /^[A-Za-z0-9_-]{22}$/;
// Names that collide with routes. "robots.txt" can't match FEED_RE; listed anyway.
export const RESERVED_FEEDS: ReadonlySet<string> = new Set([
  "r", "api", "login", "logout", "mcp", "oauth", "n", "_next", "static", "robots.txt", "health",
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

type Index = { dir: string; byReadId: Map<string, string> };
const state = processState("feeds", () => ({}) as { secret?: Buffer; index?: Promise<Index> });

// A short key makes read ids computable offline. Fail loudly instead of regenerating the key,
// which would change every read link.
function strong(key: Buffer, where: string): Buffer {
  if (key.length < 32) throw new Error(`${where} must be at least 32 bytes (e.g. openssl rand -hex 32), got ${key.length}`);
  return key;
}

export function secret(): Buffer {
  if (state.secret) return state.secret;
  const env = config.secret();
  return (state.secret = env ? strong(Buffer.from(env), "NOTEFEED_SECRET") : strong(loadOrCreateSecret(), secretPath()));
}

export function readId(feed: string): string {
  return createHmac("sha256", secret()).update(feed).digest("base64url").slice(0, 22);
}

// The index is read from disk once and then kept current by addFeed(), called by the only code that
// creates feeds (createNote). Keyed by DATA_DIR, so a changed DATA_DIR (tests) rebuilds it.
// ponytail: feed directories added or removed by hand show up after a restart; one process per DATA_DIR.

async function load(dir: string): Promise<Index> {
  const names = (await listFeedDirs()).filter((n) => checkFeed(n) === null);
  return { dir, byReadId: new Map(names.map((n) => [readId(n), n])) };
}

async function feedIndex(): Promise<Index> {
  const dir = config.dataDir();
  const current = state.index && (await state.index);
  if (current?.dir === dir) return current;
  const loading = (state.index = load(dir));
  loading.catch(() => state.index === loading && (state.index = undefined)); // retry after a failed read
  return loading;
}

export async function addFeed(feed: string): Promise<void> {
  (await feedIndex()).byReadId.set(readId(feed), feed);
}

export async function listFeeds(): Promise<string[]> {
  return [...(await feedIndex()).byReadId.values()];
}

export async function feedCount(): Promise<number> {
  return (await feedIndex()).byReadId.size;
}

export async function hasFeed(feed: string): Promise<boolean> {
  return checkFeed(feed) === null && (await feedIndex()).byReadId.has(readId(feed));
}

// A Map lookup: its timing depends on the hash of the id, not on how much of it matches a real one.
export async function feedForReadId(id: string): Promise<string | null> {
  if (!READ_ID_RE.test(id)) return null;
  return (await feedIndex()).byReadId.get(id) ?? null;
}

export const resetFeedsForTests = () => {
  state.secret = undefined;
  state.index = undefined;
};
