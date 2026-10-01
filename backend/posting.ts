// The one way a note gets posted, for the HTTP API and the web UI alike. Credentials are the
// caller's job (bearer vs. session cookie); everything after that is here, in this order.
import { config } from "./config";
import { FeedExistsError, FeedLimitError, NoteLimitError, RateLimitedError } from "./errors";
import { type FeedAccess, checkFeedAccess, createProtected, protectedFeed } from "./feedlock";
import { assertFeed, feedCount, hasFeed } from "./feeds";
import { rateLimit } from "./limits";
import { checkMarkdown, countNotes, createNote, type Note } from "./notes";

// `readMarkdown` runs only once the post is admitted, so a refused request never has its body read.
// A password (header, or body `password`) is set only by the post that creates the feed.
export async function postNote(
  feed: string,
  ip: string,
  read: () => Promise<{ markdown: string; password?: string }>,
  access: FeedAccess,
): Promise<Note> {
  assertFeed(feed);
  await checkFeedAccess(feed, access, ip);
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
  const password = access.password ?? bodyPassword;
  // A protected feed was already unlocked above; an open existing one can't be claimed.
  if (password !== undefined && !(exists && (await protectedFeed(feed)))) {
    if (exists) throw new FeedExistsError();
    await createProtected(feed, password);
  }
  return createNote(feed, markdown);
}
