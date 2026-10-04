// Feeds: name rules, read ids and the in-memory index of existing feeds, which answers "does it exist",
// "how many", "which feed has this read id" and "what is this feed's read id" in O(1). A feed's read id is
// a random one stored in its `.readid`; feeds from before that have none and keep the id derived from
// their name (HMAC with the server secret), so no existing read link changes.
import { createHmac, randomBytes } from "node:crypto";
import { config } from "./config";
import { createFeedDir, deleteFeedDir, listFeedDirs, readReadId, removeLeftovers, writeReadId } from "./data/feeds";
import { isErrno } from "./storage/fs/fs";
import { storage } from "./storage";
import { loadOrCreateSecret, secretPath } from "./data/secret";
import { InvalidBodyError, InvalidFeedError, NotFoundError, ReadIdTakenError, ReservedFeedError } from "./errors";
import { logger } from "./log";
import { processState } from "./state";

const log = logger("feeds");

export const FEED_RE = /^[a-z0-9_-]{1,64}$/;
export const READ_ID_RE = /^[A-Za-z0-9_-]{3,64}$/; // random ones are 22 characters
export const CUSTOM_READ_ID_RE = /^[a-z0-9_-]{3,64}$/; // the ones people choose
// Names that collide with routes. "robots.txt" can't match FEED_RE; listed anyway.
export const RESERVED_FEEDS: ReadonlySet<string> = new Set([
  "r", "api", "login", "logout", "mcp", "metrics", "oauth", "n", "_next", "static", "robots.txt", "health",
]);

// Names kept for the operator (announcements and the like), only those in NOTEFEED_RESERVED_FEEDS. Unlike RESERVED_FEEDS
// they collide with no route, so they only stop a feed from being CREATED by a post: a feed that already has such
// a name keeps working. With NOTEFEED_RESERVED_PASSWORD set, load() creates each one protected by that password
// and with its own name as read id, so /r/news is the read link for good (announcements are public by intent: no
// obfuscation, even if the feed is deleted and made again). Without the password they simply don't exist.
const heldBack = () => config.reservedFeeds().filter((n) => checkFeed(n) === null);
export const isHeldBack = (name: string) => heldBack().includes(name);
// A read id is 3 to 64 characters (22 random ones, or a chosen one), or the name of a reserved feed (its read id is its name, see load()).
export const isReadId = (id: string) => READ_ID_RE.test(id) || isHeldBack(id);

export function checkFeed(name: string): null | "invalid" | "reserved" {
  if (!FEED_RE.test(name)) return "invalid";
  return RESERVED_FEEDS.has(name) ? "reserved" : null;
}

export function assertFeed(name: string): void {
  const bad = checkFeed(name);
  if (bad === "invalid") throw new InvalidFeedError();
  if (bad === "reserved") throw new ReservedFeedError();
}

// `byFeed` holds null for a feed without a read link (its `.readid` can't be read, or its id belongs to another feed).
type Index = { dir: string; byReadId: Map<string, string>; byFeed: Map<string, string | null> };
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

// The index is read from disk once and then kept current by ensureFeed(), createProtectedFeed(), deleteFeed()
// and forgetFeed(), the only code that creates or removes feeds. Keyed by DATA_DIR, so a changed DATA_DIR
// (tests) rebuilds it.
// ponytail: a feed directory copied in by hand while the process runs is not seen until it is posted to or
// the process restarts; one removed by hand stays listed (as an empty feed) until a post or a delete finds
// it gone. One process per DATA_DIR.

const newReadId = () => randomBytes(16).toString("base64url");

// A read id somebody chose: the switch, then the format. Whether it is free is claim()'s business.
function checkReadId(id: string): void {
  if (!config.allowCustomIds()) throw new InvalidBodyError("this instance does not allow choosing read ids");
  if (!CUSTOM_READ_ID_RE.test(id)) throw new InvalidBodyError("read_id must be 3 to 64 characters: a-z, 0-9, - and _");
}

// Takes a chosen id in the index before the first await, so two feeds asking for it at once can't both get it.
// The caller gives it back (or registers the feed under it) when the disk write is done.
function claim(idx: Index, id: string, feed: string): void {
  if (idx.byReadId.has(id) || isHeldBack(id)) throw new ReadIdTakenError();
  idx.byReadId.set(id, feed);
}

// Makes the feed's directory under `wanted` (checked and claimed here) or a random read id; false = it exists.
async function makeFeed(idx: Index, feed: string, wanted: string | undefined, hash?: string): Promise<boolean> {
  if (wanted !== undefined) {
    checkReadId(wanted);
    claim(idx, wanted, feed);
  }
  const id = wanted ?? newReadId();
  let made = false;
  try {
    made = await createFeedDir(feed, id, hash);
  } finally {
    if (wanted !== undefined && idx.byReadId.get(id) === feed) idx.byReadId.delete(id);
  }
  if (made) register(idx, feed, id);
  return made;
}

// Index only: the files are the caller's business. Another feed that was given this feed's id keeps it.
function unregister(idx: Index, feed: string): void {
  const id = idx.byFeed.get(feed);
  if (id != null && idx.byReadId.get(id) === feed) idx.byReadId.delete(id);
  idx.byFeed.delete(feed);
}

// Replaces what the index had for the feed. Names and ids are secrets, so the logs below say neither.
function register(idx: Index, feed: string, id: string | null): void {
  unregister(idx, feed);
  if (id !== null && idx.byReadId.has(id)) {
    log.warn("a feed's .readid is already another feed's read id (copied directory?); using the derived read id");
    id = derivedReadId(feed);
    if (idx.byReadId.has(id)) {
      log.warn("a feed's derived read id is already another feed's read id; the feed has no read link");
      id = null; // listed and countable, but not found by read id
    }
  }
  idx.byFeed.set(feed, id);
  if (id !== null) idx.byReadId.set(id, feed);
}

// The read id of a feed directory: its `.readid`, or the derived id when it has none (a legacy feed) or the
// file holds something else (logged): that is the id the feed had before. null when the file can't be read:
// the feed is listed without a read link, because the derived id would be a different link than the one it has.
// With `strict` a read error is thrown instead (a creation that lost a race has no business registering "no link").
async function idOnDisk(feed: string, strict = false): Promise<string | null> {
  let id: string | null;
  try {
    id = await readReadId(feed);
  } catch (e) {
    if (strict) throw e;
    log.error({ err: e }, "a feed's .readid can't be read; the feed has no read link until the next start");
    return null;
  }
  if (id === null) return derivedReadId(feed);
  if (isReadId(id)) return id;
  log.warn("a feed's .readid is not a read id; using the derived read id");
  return derivedReadId(feed);
}

// One file at a time (a read per feed under Promise.all runs out of file descriptors with many feeds);
// sorted, so which of two feeds sharing an id keeps it is the same on every start.
async function load(dir: string): Promise<Index> {
  const idx: Index = { dir, byFeed: new Map(), byReadId: new Map() };
  await removeLeftovers();
  for (const n of (await listFeedDirs()).filter((n) => checkFeed(n) === null).sort()) register(idx, n, await idOnDisk(n));
  const password = config.reservedPassword();
  if (password) {
    const { hashPassword } = await import("./feedlock"); // feedlock imports this file
    for (const n of heldBack().filter((n) => !idx.byFeed.has(n))) {
      if (!idx.byReadId.has(n) && (await createFeedDir(n, n, await hashPassword(password)))) register(idx, n, n);
    }
  }
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

// The one way a feed comes to exist. The index is loaded first (a directory the first load finds without
// `.readid` is a legacy feed), then the directory is made already holding its `.readid` (see createFeedDir),
// and only then does the caller write anything into it: a crash can't leave notes without their read id.
// A failed note write may leave an empty directory with `.readid`; that is accepted. Returns the feed's read
// id (null: it has no read link). The directory of a listed feed can be gone (see deleteFeed): the caller's
// write is then ENOENT, and forgetFeed() and a second call make the feed anew.
// `wanted` is the read id the creating post asked for: used only when this call creates the feed, ignored otherwise.
export async function ensureFeed(feed: string, wanted?: string): Promise<string | null> {
  const idx = await feedIndex();
  const known = idx.byFeed.get(feed);
  if (known !== undefined) return known;
  if (isHeldBack(feed)) throw new ReservedFeedError();
  if (await makeFeed(idx, feed, wanted)) return idx.byFeed.get(feed) ?? null;
  else {
    // Lost a race: use the winner's id, unless the winner (or a later creation) is registered by now. What
    // was read from disk may then be older than the entry.
    const theirs = await idOnDisk(feed, true);
    if (!idx.byFeed.has(feed)) register(idx, feed, theirs);
  }
  return idx.byFeed.get(feed) ?? null;
}

// A protected feed: its directory appears already holding the hash and `.readid`. false = the feed exists.
export async function createProtectedFeed(feed: string, hash: string, wanted?: string): Promise<boolean> {
  return makeFeed(await feedIndex(), feed, wanted, hash);
}

// Removes a feed with everything in it: false when there is no such feed. The directory goes first, in one
// rename, and the index entry after it, so for a moment the index lists a feed whose directory is gone:
// readers see an empty feed, a second delete finds no directory, and a post gets ENOENT and makes a new
// feed (new read id, no password). The entry is dropped only while it is still the one looked up: a feed
// created under the name meanwhile has another id and stays. A rename that fails for another reason than a
// missing directory throws, with the index and the disk as they were.
// ponytail: no lock per feed. Two deletes and a creation of one name within the same few milliseconds can
// leave the name listed without a directory until the next post or delete, which both put it right. Worse:
// the second delete was admitted against the old feed and renames the NEW feed's directory away, even if
// that was created protected, so the creating post's note is lost or that post is a 500. A per-feed lock is the fix.
export async function deleteFeed(feed: string): Promise<boolean> {
  const idx = await feedIndex();
  const id = idx.byFeed.get(feed);
  if (id === undefined) return false;
  const removed = await deleteFeedDir(feed);
  if (idx.byFeed.get(feed) === id) unregister(idx, feed);
  return removed;
}

// For a writer that found a listed feed's directory missing (deleted a moment ago, or removed by hand):
// drops the entry, unless the name was registered anew since, which `id` (from ensureFeed) tells.
export async function forgetFeed(feed: string, id: string | null): Promise<void> {
  const idx = await feedIndex();
  if (idx.byFeed.get(feed) === id) unregister(idx, feed);
}

// Gives a feed another read id: `wanted` (a-z 0-9 - _, free), or a random one when null. The old id is freed, nothing
// is recorded: it answers like an unknown read id until another feed takes it. Notes are not touched (a relative
// image link follows the id, an absolute one is the user's to change). A reserved feed keeps its id: the caller checks.
// ponytail: one change at a time for the whole process, so two on one feed can't leave the index and `.readid` apart;
// a per-feed lock if changes ever get frequent.
let changing: Promise<unknown> = Promise.resolve();
export function setReadId(feed: string, wanted: string | null): Promise<string> {
  const run = changing.then(() => change(feed, wanted));
  changing = run.catch(() => {});
  return run;
}

async function change(feed: string, wanted: string | null): Promise<string> {
  const idx = await feedIndex();
  const old = idx.byFeed.get(feed);
  if (old === undefined) throw new NotFoundError("no such feed");
  if (wanted !== null) {
    if (wanted === old) return old;
    checkReadId(wanted);
    claim(idx, wanted, feed);
  }
  const id = wanted ?? newReadId();
  idx.byReadId.set(id, feed);
  try {
    await writeReadId(feed, id);
  } catch (e) {
    idx.byReadId.delete(id);
    throw isErrno(e, "ENOENT") ? new NotFoundError("no such feed") : e;
  }
  if (old !== null && idx.byReadId.get(old) === feed) idx.byReadId.delete(old);
  idx.byFeed.set(feed, id);
  return id;
}

/** null for a feed that doesn't exist, and for one without a read link (see the index). */
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
  if (!isReadId(id)) return null;
  return (await feedIndex()).byReadId.get(id) ?? null;
}

// Reserved feeds load() did not make, because the name was already an ordinary feed: it stays open (no `.password`)
// or keeps another read id than its name. For the startup log; nothing while NOTEFEED_RESERVED_PASSWORD is unset.
export async function reservedFeedProblems(): Promise<{ feed: string; problem: "unprotected" | "read_id" }[]> {
  if (!config.reservedPassword()) return [];
  const idx = await feedIndex();
  const found: { feed: string; problem: "unprotected" | "read_id" }[] = [];
  for (const feed of heldBack().filter((n) => idx.byFeed.has(n))) {
    if ((await storage().readHash(feed)) === null) found.push({ feed, problem: "unprotected" });
    else if (idx.byFeed.get(feed) !== feed) found.push({ feed, problem: "read_id" });
  }
  return found;
}

export const resetFeedsForTests = () => {
  state.secret = undefined;
  state.index = undefined;
};
