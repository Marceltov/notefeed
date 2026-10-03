// The one way a note gets posted, edited or deleted, for the HTTP API, MCP and the web UI alike. Credentials are the
// caller's job (bearer vs. session cookie); everything after that is here, in this order.
import { config } from "./config";
import { FeedExistsError, FeedLimitError, ImageLimitError, InvalidBodyError, NotFoundError, NoteLimitError, RateLimitedError, UnsupportedTypeError } from "./errors";
import { type FeedAccess, checkFeedAccess, createProtected } from "./feedlock";
import { type FeedSettings, checkSettings, getStoredSettings, saveSettings } from "./feedsettings";
import { assertFeed, deleteFeed as removeWholeFeed, feedCount, hasFeed, isHeldBack, readIdOf, setReadId } from "./feeds";
import { sniffImage } from "./images";
import { capReached, rateLimit } from "./limits";
import { checkTags } from "./tags";
import { checkLine, checkMarkdown, countNotes, createImageNote, createNote, hasImageNote, MAX_ALT, MAX_NOTE_TITLE, removeNote, updateNote, type Note, type NoteEdit } from "./notes";

// What a post carries besides the note itself. `name` is the file name an image came with.
export type PostInput = { password?: string; tags?: string[]; readId?: string; name?: string; title?: string; alt?: string } & ({ markdown: string } | { image: Uint8Array });

// `read` runs only once the post is admitted, so a refused request never has its body read.
// A password (header, or body `password`) is set only by the post that creates the feed.
// `created`: this post created the feed protected, so its sender is the one who chose the password.
// `readId` (in what `read` gives): the read id the new feed should get; ignored when the feed exists, random when empty or left out.
// `readId` (in the result): the read id of the feed the note went into; null when that feed has no read link.
export async function postNote(
  feed: string,
  ip: string,
  read: () => Promise<PostInput>,
  access: FeedAccess,
  sender?: string, // verified by the caller (identity cookie or OAuth token), never taken from a request body
): Promise<{ note: Note; created: boolean; readId: string | null }> {
  assertFeed(feed);
  const proved = await checkFeedAccess(feed, access, ip);
  const wait = rateLimit(ip);
  if (wait !== null) throw new RateLimitedError(wait);

  // ponytail: caps are checked, not locked; concurrent posts can overshoot by a few.
  const maxFeeds = config.maxFeeds();
  const maxNotes = config.maxNotesPerFeed();
  const maxImages = config.maxImagesPerFeed();
  const exists = await hasFeed(feed);
  if (maxFeeds && !exists && (await feedCount()) >= maxFeeds) throw capReached("feed", new FeedLimitError());

  const input = await read();
  const { password: bodyPassword, tags: given, readId: asked } = input;
  const isImage = "image" in input;
  // The caps are per kind: images have their own, the notes limit counts the markdown ones.
  if (exists && isImage && maxImages && (await countNotes(feed, "image")) >= maxImages) throw capReached("image", new ImageLimitError());
  if (exists && !isImage && maxNotes && (await countNotes(feed, "markdown")) >= maxNotes) throw capReached("note", new NoteLimitError());
  const wantedReadId = exists || !asked?.trim() ? undefined : asked.trim();
  // Before createProtected: a refused note must not leave a protected, empty feed.
  if (isImage) {
    if (!sniffImage(input.image)) throw new UnsupportedTypeError("send a PNG, JPEG, GIF or WebP image");
  } else checkMarkdown(input.markdown);
  checkLine("title", input.title, MAX_NOTE_TITLE);
  checkLine("alt", input.alt, MAX_ALT);
  const tags = checkTags(given);
  const password = (access.password ?? bodyPassword) || undefined; // empty means none
  let created = false;
  // A protected feed was already unlocked above; an open existing one can't be claimed.
  if (!proved && password !== undefined) {
    if (exists) throw new FeedExistsError();
    await createProtected(feed, password, wantedReadId);
    created = true;
  }
  // The sender decides how long read() takes, and the feed may have been created protected meanwhile:
  // a post that proved nothing above is checked again, with nothing to show.
  if (!proved && !created) await checkFeedAccess(feed, {}, ip);
  // ponytail: checked, not locked. A protected creation can still complete in the few microseconds between
  // this check and createNote's ensureFeed, which then finds the feed and writes into it: this one note is
  // then in the protected feed. A lock around creation, per feed, would close it.
  const made = isImage
    ? await createImageNote(feed, input.image, { sender, tags, name: input.name, title: input.title, alt: input.alt, wantedReadId })
    : await createNote(feed, input.markdown, undefined, sender, tags, wantedReadId, input.title);
  return { ...made, created };
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

export async function editNote(feed: string, id: string, ip: string, read: () => Promise<NoteEdit>, access: FeedAccess): Promise<Note> {
  await admit(feed, ip, access);
  const note = await updateNote(feed, id, await read());
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
  const given = checkSettings(await read()); // after admit: a refused request never has its body read
  if (!(await hasFeed(feed))) throw new NotFoundError("no such feed");
  // Only a given image is checked; an omitted one stays as stored, even if its file has been removed by hand.
  if (given.image && !(await hasImageNote(feed, given.image))) throw new InvalidBodyError("image must be empty or the file of an image note of this feed");
  const stored = await getStoredSettings(feed);
  const { readId, ...rest } = given;
  const newId = readId === undefined || readId === (await readIdOf(feed)) ? undefined : readId; // the page sends the current one back: no change
  if (newId !== undefined && isHeldBack(feed)) throw new InvalidBodyError("a reserved feed keeps its read id");
  // First, so a read id that is refused (taken, badly formed, not allowed) saves nothing.
  if (newId !== undefined) await setReadId(feed, newId === "" ? null : newId);
  const checked = { ...rest, image: rest.image ?? stored.image, showSender: given.showSender ?? stored.showSender };
  await saveSettings(feed, checked);
  return checked;
}

export async function deleteFeed(feed: string, ip: string, access: FeedAccess): Promise<void> {
  await admit(feed, ip, access);
  if (!(await removeWholeFeed(feed))) throw new NotFoundError("no such feed");
}
