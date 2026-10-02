// The one way a note gets posted, edited or deleted, for the HTTP API, MCP and the web UI alike. Credentials are the
// caller's job (bearer vs. session cookie); everything after that is here, in this order.
import { config } from "./config";
import { FeedExistsError, FeedLimitError, NotFoundError, NoteLimitError, RateLimitedError } from "./errors";
import { type FeedAccess, checkFeedAccess, createProtected } from "./feedlock";
import { type FeedSettings, checkSettings, saveSettings } from "./feedsettings";
import { assertFeed, deleteFeed as removeWholeFeed, feedCount, hasFeed } from "./feeds";
import { rateLimit } from "./limits";
import { checkMarkdown, countNotes, createNote, removeNote, updateNote, type Note } from "./notes";

// `readMarkdown` runs only once the post is admitted, so a refused request never has its body read.
// A password (header, or body `password`) is set only by the post that creates the feed.
// `created`: this post created the feed protected, so its sender is the one who chose the password.
// `readId`: the read id of the feed the note went into; null when that feed has no read link.
export async function postNote(
  feed: string,
  ip: string,
  read: () => Promise<{ markdown: string; password?: string }>,
  access: FeedAccess,
): Promise<{ note: Note; created: boolean; readId: string | null }> {
  assertFeed(feed);
  const proved = await checkFeedAccess(feed, access, ip);
  const wait = rateLimit(ip);
  if (wait !== null) throw new RateLimitedError(wait);

  // ponytail: caps are checked, not locked; concurrent posts can overshoot by a few.
  const maxFeeds = config.maxFeeds();
  const maxNotes = config.maxNotesPerFeed();
  const exists = await hasFeed(feed);
  if (maxFeeds && !exists && (await feedCount()) >= maxFeeds) throw new FeedLimitError();
  if (maxNotes && exists && (await countNotes(feed)) >= maxNotes) throw new NoteLimitError();

  const { markdown, password: bodyPassword } = await read();
  checkMarkdown(markdown); // before createProtected: a refused note must not leave a protected, empty feed
  const password = (access.password ?? bodyPassword) || undefined; // empty means none
  let created = false;
  // A protected feed was already unlocked above; an open existing one can't be claimed.
  if (!proved && password !== undefined) {
    if (exists) throw new FeedExistsError();
    await createProtected(feed, password);
    created = true;
  }
  // The sender decides how long read() takes, and the feed may have been created protected meanwhile:
  // a post that proved nothing above is checked again, with nothing to show.
  if (!proved && !created) await checkFeedAccess(feed, {}, ip);
  // ponytail: checked, not locked. A protected creation can still complete in the few microseconds between
  // this check and createNote's ensureFeed, which then finds the feed and writes into it: this one note is
  // then in the protected feed. A lock around creation, per feed, would close it.
  return { ...(await createNote(feed, markdown)), created };
}

// Same gate as posting, minus the caps. An edit or delete targets an existing note, so its feed
// already exists, and the feed's protection can only be changed by a request that proved the password:
// no second access check after `read()`, unlike postNote.
async function admit(feed: string, ip: string, access: FeedAccess): Promise<void> {
  assertFeed(feed);
  await checkFeedAccess(feed, access, ip);
  const wait = rateLimit(ip);
  if (wait !== null) throw new RateLimitedError(wait);
}

export async function editNote(feed: string, id: string, ip: string, read: () => Promise<{ markdown: string }>, access: FeedAccess): Promise<Note> {
  await admit(feed, ip, access);
  const { markdown } = await read();
  checkMarkdown(markdown);
  const note = await updateNote(feed, id, markdown);
  if (!note) throw new NotFoundError("no such note");
  return note;
}

export async function deleteNote(feed: string, id: string, ip: string, access: FeedAccess): Promise<void> {
  await admit(feed, ip, access);
  if (!(await removeNote(feed, id))) throw new NotFoundError("no such note");
}

// Settings and deletion of a whole feed: the same gate as posting, then the feed must exist. An open feed is
// changed by anyone who knows its name, as it is posted to (ADR 0001); a protected one needs its password.
export async function updateFeed(feed: string, ip: string, read: () => Promise<unknown>, access: FeedAccess): Promise<FeedSettings> {
  await admit(feed, ip, access);
  const checked = checkSettings(await read()); // after admit: a refused request never has its body read
  if (!(await hasFeed(feed))) throw new NotFoundError("no such feed");
  await saveSettings(feed, checked);
  return checked;
}

export async function deleteFeed(feed: string, ip: string, access: FeedAccess): Promise<void> {
  await admit(feed, ip, access);
  if (!(await removeWholeFeed(feed))) throw new NotFoundError("no such feed");
}
