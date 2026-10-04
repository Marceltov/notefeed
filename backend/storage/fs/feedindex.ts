// The feed methods of the file system backend. A feed is a directory (feeds.ts); this keeps the in-memory index of the existing
// feeds, which answers "does it exist", "how many", "which feed has this read id" and "what is this feed's read id" in O(1).
// A feed's read id is a random one stored in its `.readid`; feeds from before that have none and keep the id derived from
// their name (HMAC with the server secret), so no existing read link changes.
import { NotFoundError, ReadIdTakenError } from "../../errors";
import { logger } from "../../log";
import type { Storage } from "../types";
import { createFeedDir, deleteFeedDir, listFeedDirs, readReadId, removeLeftovers, writeReadId } from "./feeds";
import { isErrno } from "./fs";

const log = logger("feeds");

export type FeedDeps = {
  derivedReadId(feed: string): string;
  isReadId(id: string): boolean;
  /** Whether a directory name is a feed (anything else in DATA_DIR is ignored). */
  isFeedName(name: string): boolean;
};

// `byFeed` holds null for a feed without a read link (its `.readid` can't be read, or its id belongs to another feed).
type Index = { dir: string; byReadId: Map<string, string>; byFeed: Map<string, string | null> };

type FeedMethods = Pick<Storage, "createFeed" | "deleteFeed" | "forgetFeed" | "setReadId" | "feedReadId" | "feedForReadId" | "listFeeds" | "listFeedNames" | "feedCount">;

export function createFeedMethods(deps: FeedDeps, dataDir: () => string): FeedMethods {
  // The index is read from disk once and then kept current by createFeed(), deleteFeed() and forgetFeed(), the only code that
  // creates or removes feeds. Keyed by DATA_DIR, so a changed DATA_DIR (tests) rebuilds it.
  // ponytail: a feed directory copied in by hand while the process runs is not seen until it is posted to or
  // the process restarts; one removed by hand stays listed (as an empty feed) until a post or a delete finds
  // it gone. One process per DATA_DIR.
  let loaded: Promise<Index> | undefined;

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
      id = deps.derivedReadId(feed);
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
    if (id === null) return deps.derivedReadId(feed);
    if (deps.isReadId(id)) return id;
    log.warn("a feed's .readid is not a read id; using the derived read id");
    return deps.derivedReadId(feed);
  }

  // One file at a time (a read per feed under Promise.all runs out of file descriptors with many feeds);
  // sorted, so which of two feeds sharing an id keeps it is the same on every start.
  async function load(dir: string): Promise<Index> {
    const idx: Index = { dir, byFeed: new Map(), byReadId: new Map() };
    await removeLeftovers();
    for (const n of (await listFeedDirs()).filter(deps.isFeedName).sort()) register(idx, n, await idOnDisk(n));
    return idx;
  }

  async function index(): Promise<Index> {
    const dir = dataDir();
    const current = loaded && (await loaded);
    if (current?.dir === dir) return current;
    const loading = (loaded = load(dir));
    loading.catch(() => loaded === loading && (loaded = undefined)); // retry after a failed read
    return loading;
  }

  // One change of a read id at a time for the whole process, so two on one feed can't leave the index and `.readid` apart;
  // a per-feed lock if changes ever get frequent.
  let changing: Promise<unknown> = Promise.resolve();

  return {
    // The directory is made already holding its `.readid` (see createFeedDir), so a crash can't leave notes without their read id.
    // The id is taken in the index before the first await, so two feeds asking for it at once can't both get it.
    async createFeed(feed, readId, hash) {
      const idx = await index();
      if (idx.byReadId.has(readId)) throw new ReadIdTakenError();
      idx.byReadId.set(readId, feed);
      let made = false;
      try {
        made = await createFeedDir(feed, readId, hash);
      } finally {
        if (idx.byReadId.get(readId) === feed) idx.byReadId.delete(readId);
      }
      if (made) register(idx, feed, readId);
      else {
        // Lost a race (or the feed exists): use the winner's id, unless the winner (or a later creation) is registered by now.
        // What was read from disk may then be older than the entry.
        const theirs = await idOnDisk(feed, true);
        if (!idx.byFeed.has(feed)) register(idx, feed, theirs);
      }
      return { created: made };
    },

    // The directory goes first, in one rename, and the index entry after it, so for a moment the index lists a feed whose
    // directory is gone: readers see an empty feed, a second delete finds no directory, and a post gets FeedGoneError and makes a
    // new feed (new read id, no password). The entry is dropped only while it is still the one looked up: a feed created under
    // the name meanwhile has another id and stays.
    // ponytail: no lock per feed. Two deletes and a creation of one name within the same few milliseconds can
    // leave the name listed without a directory until the next post or delete, which both put it right. Worse:
    // the second delete was admitted against the old feed and renames the NEW feed's directory away, even if
    // that was created protected, so the creating post's note is lost or that post is a 500. A per-feed lock is the fix.
    async deleteFeed(feed) {
      const idx = await index();
      const id = idx.byFeed.get(feed);
      if (id === undefined) return false;
      const removed = await deleteFeedDir(feed);
      if (idx.byFeed.get(feed) === id) unregister(idx, feed);
      return removed;
    },

    async forgetFeed(feed, readId) {
      const idx = await index();
      if (idx.byFeed.get(feed) === readId) unregister(idx, feed);
    },

    setReadId(feed, readId) {
      const run = changing.then(async () => {
        const idx = await index();
        const old = idx.byFeed.get(feed);
        if (old === undefined) throw new NotFoundError("no such feed");
        if (readId === old) return;
        if (idx.byReadId.has(readId)) throw new ReadIdTakenError();
        idx.byReadId.set(readId, feed);
        try {
          await writeReadId(feed, readId);
        } catch (e) {
          idx.byReadId.delete(readId);
          throw isErrno(e, "ENOENT") ? new NotFoundError("no such feed") : e;
        }
        if (old !== null && idx.byReadId.get(old) === feed) idx.byReadId.delete(old);
        idx.byFeed.set(feed, readId);
      });
      changing = run.catch(() => {});
      return run;
    },

    async feedReadId(feed) {
      return (await index()).byFeed.get(feed);
    },
    // A Map lookup: its timing depends on the hash of the id, not on how much of it matches a real one.
    async feedForReadId(readId) {
      return (await index()).byReadId.get(readId) ?? null;
    },
    async listFeeds() {
      return [...(await index()).byFeed.keys()];
    },
    async listFeedNames() {
      await index(); // removes the leftovers of a crash first
      return listFeedDirs();
    },
    async feedCount() {
      return (await index()).byFeed.size;
    },
  };
}
