// Feeds: creating, deleting and finding them, and the rules for their read ids. Names and their rules are in feednames.ts, where
// they live is the storage backend's business (backend/storage). A feed's read id is a random one; feeds from before that
// have the id derived from their name (HMAC with the server secret, secret.ts), so no existing read link changes.
import { randomBytes } from "node:crypto";
import { config } from "./config";
import { InvalidBodyError, NotFoundError, ReadIdTakenError, ReservedFeedError } from "./errors";
import { checkFeed, CUSTOM_READ_ID_RE, heldBack, isHeldBack, isReadId } from "./feednames";
import { logger } from "./log";
import { resetSecretForTests } from "./secret";
import { storage, resetStorageForTests } from "./storage";
import type { Storage } from "./storage/types";

export { assertFeed, checkFeed, CUSTOM_READ_ID_RE, FEED_RE, isHeldBack, isReadId, READ_ID_RE, RESERVED_FEEDS } from "./feednames";
export { derivedReadId, secret } from "./secret";

const log = logger("feeds");

const newReadId = () => randomBytes(16).toString("base64url");

// A read id somebody chose: the switch, then the format, then whether it is held back. Whether it is free is the storage's business.
function checkReadId(id: string): void {
  if (!config.allowCustomIds()) throw new InvalidBodyError("this instance does not allow choosing read ids");
  if (!CUSTOM_READ_ID_RE.test(id)) throw new InvalidBodyError("read_id must be 3 to 64 characters: a-z, 0-9, - and _");
  if (isHeldBack(id)) throw new ReadIdTakenError();
}

// The reserved feeds exist only while NOTEFEED_RESERVED_PASSWORD is set: each is made, once per storage, protected by that password
// and with its own name as read id, unless the name is already an ordinary feed (reservedFeedProblems says so at start-up).
const ready = new WeakMap<Storage, Promise<Storage>>();
function prepared(): Promise<Storage> {
  const s = storage();
  let p = ready.get(s);
  if (!p) {
    p = makeReservedFeeds(s).then(() => s);
    ready.set(s, p);
    p.catch(() => ready.get(s) === p && ready.delete(s)); // retry after a failure
  }
  return p;
}

async function makeReservedFeeds(s: Storage): Promise<void> {
  const password = config.reservedPassword();
  if (!password) return;
  const { hashPassword } = await import("./feedlock"); // feedlock imports this file
  for (const n of heldBack()) {
    if ((await s.feedReadId(n)) !== undefined || (await s.feedForReadId(n)) !== null) continue;
    await s.createFeed(n, n, await hashPassword(password)).catch((e) => {
      if (!(e instanceof ReadIdTakenError)) throw e; // another process was first
    });
  }
}

// The one way a feed comes to exist. The feed is made already holding its read id (and its password hash, if protected), and
// only then does the caller write anything into it: a crash can't leave notes without their read id. A failed note write may
// leave an empty feed; that is accepted. Returns the feed's read id (null: it has no read link). A listed feed can be gone from
// the storage (see deleteFeed): the caller's write is then a FeedGoneError, and forgetFeed() and a second call make the feed anew.
// `wanted` is the read id the creating post asked for: used only when this call creates the feed, ignored otherwise.
export async function ensureFeed(feed: string, wanted?: string): Promise<string | null> {
  const s = await prepared();
  const known = await s.feedReadId(feed);
  if (known !== undefined) return known;
  if (isHeldBack(feed)) throw new ReservedFeedError();
  if (wanted !== undefined) checkReadId(wanted);
  if ((await s.createFeed(feed, wanted ?? newReadId())).created) log.info({ protected: false }, "feed created"); // never its name
  return (await s.feedReadId(feed)) ?? null;
}

// A protected feed: it appears already holding the hash and its read id. false = the feed exists.
export async function createProtectedFeed(feed: string, hash: string, wanted?: string): Promise<boolean> {
  const s = await prepared();
  if (wanted !== undefined) checkReadId(wanted);
  const { created } = await s.createFeed(feed, wanted ?? newReadId(), hash);
  if (created) log.info({ protected: true }, "feed created");
  return created;
}

// Removes a feed with everything in it: false when there is no such feed.
export async function deleteFeed(feed: string): Promise<boolean> {
  const deleted = await (await prepared()).deleteFeed(feed);
  if (deleted) log.info("feed deleted");
  return deleted;
}

// For a writer that found a listed feed gone (deleted a moment ago, or removed by hand): drops the entry, unless the name was
// registered anew since, which `id` (from ensureFeed) tells.
export async function forgetFeed(feed: string, id: string | null): Promise<void> {
  await (await prepared()).forgetFeed(feed, id);
}

// Gives a feed another read id: `wanted` (a-z 0-9 - _, free), or a random one when null. The old id is freed, nothing
// is recorded: it answers like an unknown read id until another feed takes it. Notes are not touched (a relative
// image link follows the id, an absolute one is the user's to change). A reserved feed keeps its id: the caller checks.
export async function setReadId(feed: string, wanted: string | null): Promise<string> {
  const s = await prepared();
  const old = await s.feedReadId(feed);
  if (old === undefined) throw new NotFoundError("no such feed");
  if (wanted !== null) {
    if (wanted === old) return old;
    checkReadId(wanted);
  }
  const id = wanted ?? newReadId();
  await s.setReadId(feed, id);
  return id;
}

/** null for a feed that doesn't exist, and for one without a read link. */
export async function readIdOf(feed: string): Promise<string | null> {
  return (await (await prepared()).feedReadId(feed)) ?? null;
}

export async function listFeeds(): Promise<string[]> {
  return (await prepared()).listFeeds();
}

export async function feedCount(): Promise<number> {
  return (await prepared()).feedCount();
}

export async function hasFeed(feed: string): Promise<boolean> {
  return checkFeed(feed) === null && (await (await prepared()).feedReadId(feed)) !== undefined;
}

export async function feedForReadId(id: string): Promise<string | null> {
  if (!isReadId(id)) return null;
  return (await prepared()).feedForReadId(id);
}

// Reserved feeds makeReservedFeeds did not make, because the name was already an ordinary feed: it stays open (no password)
// or keeps another read id than its name. For the startup log; nothing while NOTEFEED_RESERVED_PASSWORD is unset.
export async function reservedFeedProblems(): Promise<{ feed: string; problem: "unprotected" | "read_id" }[]> {
  if (!config.reservedPassword()) return [];
  const s = await prepared();
  const found: { feed: string; problem: "unprotected" | "read_id" }[] = [];
  for (const feed of heldBack()) {
    const id = await s.feedReadId(feed);
    if (id === undefined) continue;
    if ((await s.readHash(feed)) === null) found.push({ feed, problem: "unprotected" });
    else if (id !== feed) found.push({ feed, problem: "read_id" });
  }
  return found;
}

export const resetFeedsForTests = () => {
  resetSecretForTests();
  resetStorageForTests();
};
