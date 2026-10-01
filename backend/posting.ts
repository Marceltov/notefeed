// The one way a note gets posted, for the HTTP API and the web UI alike. Credentials are the
// caller's job (bearer vs. session cookie); everything after that is here, in this order.
import { config } from "./config";
import { FeedLimitError, NoteLimitError, RateLimitedError } from "./errors";
import { assertFeed, feedCount, hasFeed } from "./feeds";
import { rateLimit } from "./limits";
import { countNotes, createNote, type Note } from "./notes";

// `readMarkdown` runs only once the post is admitted, so a refused request never has its body read.
export async function postNote(feed: string, ip: string, readMarkdown: () => Promise<string>): Promise<Note> {
  assertFeed(feed);
  const wait = rateLimit(ip);
  if (wait !== null) throw new RateLimitedError(wait);

  // ponytail: caps are checked, not locked; concurrent posts can overshoot by a few.
  const maxFeeds = config.maxFeeds();
  const maxNotes = config.maxNotesPerFeed();
  if (maxFeeds || maxNotes) {
    const exists = await hasFeed(feed);
    if (maxFeeds && !exists && (await feedCount()) >= maxFeeds) throw new FeedLimitError();
    if (maxNotes && exists && (await countNotes(feed)) >= maxNotes) throw new NoteLimitError();
  }

  return createNote(feed, await readMarkdown());
}
