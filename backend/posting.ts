// The one way a note gets posted, for the HTTP API and the web UI alike. Credentials are the
// caller's job (bearer vs. session cookie); everything after that is here, in this order.
import { config } from "./config";
import { FeedExistsError, FeedLimitError, NoteLimitError, RateLimitedError } from "./errors";
import { type FeedAccess, checkFeedAccess, createProtected } from "./feedlock";
import { assertFeed, feedCount, hasFeed } from "./feeds";
import { rateLimit } from "./limits";
import { checkMarkdown, countNotes, createNote, type Note } from "./notes";

// `readMarkdown` runs only once the post is admitted, so a refused request never has its body read.
// A password (header, or body `password`) is set only by the post that creates the feed.
// `created`: this post created the feed protected, so its sender is the one who chose the password.
export async function postNote(
  feed: string,
  ip: string,
  read: () => Promise<{ markdown: string; password?: string }>,
  access: FeedAccess,
): Promise<{ note: Note; created: boolean }> {
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
  // ponytail: checked, not locked. A protected creation can still land between this check and the note's
  // file when its rename() claims the directory writeNote just made (empty for a few microseconds), and
  // that one note is then in the protected feed. A lock around creation, per feed, would close it.
  return { note: await createNote(feed, markdown), created };
}
