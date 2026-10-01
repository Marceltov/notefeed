// Feeds: name rules, read ids and the in-memory index of existing feeds, which answers "does it exist",
// "how many", "which feed has this read id" and "what is this feed's read id" in O(1). A feed's read id is
// a random one stored in its `.readid`; feeds from before that have none and keep the id derived from
// their name (HMAC with the server secret), so no existing read link changes.
import { createHmac, randomBytes } from "node:crypto";
import { config } from "./config";
import { createFeedDir, deleteFeedDir, listFeedDirs, readReadId, removeDeletedLeftovers } from "./data/feeds";
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

// The index is read from disk once and then kept current by ensureFeed() and createProtectedFeed(), the
// only code that creates feeds. Keyed by DATA_DIR, so a changed DATA_DIR (tests) rebuilds it.
// ponytail: a feed directory copied in or deleted by hand while the process runs is not seen until a
// restart (a copied one then keeps its `.readid`, or the derived id if that id is taken); one process per DATA_DIR.

const newReadId = () => randomBytes(16).toString("base64url");

// Names and ids are secrets, so the logs below say neither.
function register(idx: Index, feed: string, id: string): void {
  const owner = idx.byReadId.get(id);
  if (owner !== undefined && owner !== feed) {
    console.error("a feed's .readid is already another feed's read id (copied directory?); using the derived read id");
    id = derivedReadId(feed);
    const taken = idx.byReadId.get(id);
    if (taken !== undefined && taken !== feed) {
      console.error("a feed's derived read id is already another feed's read id; the feed has no read link");
      idx.byFeed.set(feed, id); // listed and countable, but not found by read id
      return;
    }
  }
  idx.byFeed.set(feed, id);
  idx.byReadId.set(id, feed);
}

// A present but invalid file is ignored (logged): the derived id is what the feed had before.
async function storedOrDerived(feed: string): Promise<string> {
  const id = await readReadId(feed);
  if (id === null) return derivedReadId(feed);
  if (READ_ID_RE.test(id)) return id;
  console.error("a feed's .readid is not a read id; using the derived read id");
  return derivedReadId(feed);
}

// One file at a time (a read per feed under Promise.all runs out of file descriptors with many feeds);
// sorted, so which of two feeds sharing an id keeps it is the same on every start.
async function load(dir: string): Promise<Index> {
  const idx: Index = { dir, byFeed: new Map(), byReadId: new Map() };
  await removeDeletedLeftovers();
  for (const n of (await listFeedDirs()).filter((n) => checkFeed(n) === null).sort()) register(idx, n, await storedOrDerived(n));
  return idx;
}

async function feedIndex(): Promise<Index> {
  const dir = config.dataDir();
  const current = state.index && (await state.index);
  if (current?.dir === dir) return current;
  const loading = (state.index = load(dir));
  loading.catch(() => state.index === loading && (state.index = undefined)); // retry after a failed read
  return loading;
}

// Waits for deletes of this feed in progress. The caller reads the index right after, with no await between:
// a delete that starts in the same tick has then either set its marker (seen here) or not yet run (and
// then finds the feed this call made).
async function afterDeletes(feed: string): Promise<void> {
  for (let d; (d = deleting.get(feed)); ) await d.catch(() => {});
}

// The one way a feed comes to exist. The index is loaded first (a directory the first load finds without
// `.readid` is a legacy feed), then the directory is made already holding its `.readid` (see createFeedDir),
// and only then does the caller write anything into it: a crash can't leave notes without their read id.
// A failed note write may leave an empty directory with `.readid`; that is accepted. Returns the feed's read id.
export async function ensureFeed(feed: string): Promise<string> {
  const idx = await feedIndex();
  await afterDeletes(feed);
  const known = idx.byFeed.get(feed);
  if (known !== undefined) return known;
  const fresh = newReadId();
  const id = (await createFeedDir(feed, fresh)) ? fresh : await storedOrDerived(feed); // lost a race: use the winner's
  register(idx, feed, id);
  return idx.byFeed.get(feed)!;
}

// A protected feed: its directory appears already holding the hash and `.readid`. false = the feed exists.
export async function createProtectedFeed(feed: string, hash: string): Promise<boolean> {
  const idx = await feedIndex();
  await afterDeletes(feed);
  const id = newReadId();
  if (!(await createFeedDir(feed, id, hash))) return false;
  register(idx, feed, id);
  return true;
}

// Index only: the files are the caller's business. Another feed that was given this feed's id keeps it.
function unregister(idx: Index, feed: string): void {
  const id = idx.byFeed.get(feed);
  if (id !== undefined && idx.byReadId.get(id) === feed) idx.byReadId.delete(id);
  idx.byFeed.delete(feed);
}

// Deletes in progress, by feed. The index entry goes first and the directory a moment later; a creation
// meanwhile would find the old `.readid` still there and take the old id back, so it waits for the delete.
const deleting = new Map<string, Promise<boolean>>();

// Removes a feed with everything in it: false when there is no such feed. A post that already passed
// ensureFeed and writes after this is ENOENT, and createNote then makes a new feed (new read id, no password).
export async function deleteFeed(feed: string): Promise<boolean> {
  const idx = await feedIndex();
  await afterDeletes(feed);
  const id = idx.byFeed.get(feed);
  if (id === undefined) return false;
  unregister(idx, feed); // no await since the lookup, so of two deletes only one gets here
  // A rename that fails for another reason than "no such directory" leaves the feed as it was.
  const done = deleteFeedDir(feed).catch((e) => {
    register(idx, feed, id);
    throw e;
  });
  deleting.set(feed, done);
  try {
    return await done;
  } finally {
    if (deleting.get(feed) === done) deleting.delete(feed);
  }
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
  deleting.clear();
};
