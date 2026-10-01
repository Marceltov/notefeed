// Feeds: name rules, read ids and the in-memory index of existing feeds, which answers "does it exist",
// "how many", "which feed has this read id" and "what is this feed's read id" in O(1). A feed's read id is
// a random one stored in its `.readid`; feeds from before that have none and keep the id derived from
// their name (HMAC with the server secret), so no existing read link changes.
import { createHmac, randomBytes } from "node:crypto";
import { config } from "./config";
import { listFeedDirs, readReadId, writeReadId } from "./data/feeds";
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

type Index = { dir: string; byReadId: Map<string, string>; byFeed: Map<string, string> };
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

// Only the index and legacy feeds use this; everything else asks readIdOf().
export function derivedReadId(feed: string): string {
  return createHmac("sha256", secret()).update(feed).digest("base64url").slice(0, 22);
}

// The index is read from disk once and then kept current by addFeed(), called by the code that creates
// feeds (createNote, createProtected). Keyed by DATA_DIR, so a changed DATA_DIR (tests) rebuilds it.
// ponytail: feed directories added or removed by hand show up after a restart; one process per DATA_DIR.

function index(dir: string, entries: [string, string][]): Index {
  return { dir, byFeed: new Map(entries), byReadId: new Map(entries.map(([f, id]) => [id, f])) };
}

// A present but invalid file is ignored (logged): the derived id is what the feed had before.
async function storedOrDerived(feed: string): Promise<string> {
  const id = await readReadId(feed);
  if (id === null) return derivedReadId(feed);
  if (READ_ID_RE.test(id)) return id;
  console.error(`feed ${feed}: ignoring invalid .readid, using the derived read id`);
  return derivedReadId(feed);
}

async function load(dir: string): Promise<Index> {
  const names = (await listFeedDirs()).filter((n) => checkFeed(n) === null);
  return index(dir, await Promise.all(names.map(async (n): Promise<[string, string]> => [n, await storedOrDerived(n)])));
}

async function feedIndex(): Promise<Index> {
  const dir = config.dataDir();
  const current = state.index && (await state.index);
  if (current?.dir === dir) return current;
  const loading = (state.index = load(dir));
  loading.catch(() => state.index === loading && (state.index = undefined)); // retry after a failed read
  return loading;
}

// Callers that create a feed directory await this first: a feed whose directory the first load finds
// without `.readid` is a legacy feed, so the index must already be loaded when a new directory appears.
export async function feedsReady(): Promise<void> {
  await feedIndex();
}

// The feed's directory must exist. A feed new to the index gets a random read id, unless `.readid` is
// already there (another request won the race to create it): then that one is used.
export async function addFeed(feed: string): Promise<void> {
  const idx = await feedIndex();
  if (idx.byFeed.has(feed)) return;
  const fresh = randomBytes(16).toString("base64url");
  const id = (await writeReadId(feed, fresh)) ? fresh : await storedOrDerived(feed);
  idx.byFeed.set(feed, id);
  idx.byReadId.set(id, feed);
}

// Index only: the files are the caller's business.
export async function removeFeed(feed: string): Promise<void> {
  const idx = await feedIndex();
  const id = idx.byFeed.get(feed);
  if (id !== undefined) idx.byReadId.delete(id);
  idx.byFeed.delete(feed);
}

export async function readIdOf(feed: string): Promise<string | null> {
  return (await feedIndex()).byFeed.get(feed) ?? null;
}

export async function listFeeds(): Promise<string[]> {
  return [...(await feedIndex()).byFeed.keys()];
}

export async function feedCount(): Promise<number> {
  return (await feedIndex()).byFeed.size;
}

export async function hasFeed(feed: string): Promise<boolean> {
  return checkFeed(feed) === null && (await feedIndex()).byFeed.has(feed);
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
