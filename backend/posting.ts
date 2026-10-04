// The one way a note gets posted, edited or deleted, for the HTTP API, MCP and the web UI alike. Credentials are the
// caller's job (bearer vs. session cookie); everything after that is here, in this order.
import { config } from "./config";
import { idStamp } from "../shared/notes";
import { isAttachmentName, MAX_ATTACHMENTS, placeImages } from "../shared/links";
import { FeedExistsError, FeedLimitError, ImageLimitError, ImageTooLargeError, InvalidBodyError, NotefeedError, NotFoundError, NoteLimitError, RateLimitedError, UnsupportedTypeError } from "./errors";
import { type FeedAccess, checkFeedAccess, createProtected } from "./feedlock";
import { type FeedSettings, checkSettings, getStoredSettings, saveSettings } from "./feedsettings";
import { assertFeed, deleteFeed as removeWholeFeed, feedCount, hasFeed, isHeldBack, readIdOf, setReadId } from "./feeds";
import { capReached, rateLimit } from "./limits";
import { logger } from "./log";
import { MEDIA_TYPES } from "./note/media";
import { type NoteType, parseMediaType } from "./note/types";
import { checkTags } from "./tags";
import { checkLine, checkMarkdown, countNotes, createNoteOf, encoder, getNote, MARKDOWN, hasImageNote, MAX_ALT, MAX_NOTE_TITLE, removeNote, replaceContent, changeMeta, type NewNoteOptions, type Note } from "./notes";

const log = logger("posting");

// The gate every write passes first: the feed's access, then the rate limit (counted once per request). Whether the
// password was proved. An edit or delete targets an existing note, so its feed already exists, and the feed's
// protection can only be changed by a request that proved the password: no second access check after `read()`, unlike a post.
async function admit(feed: string, ip: string, access: FeedAccess): Promise<boolean> {
  assertFeed(feed);
  const proved = await checkFeedAccess(feed, access, ip);
  const wait = rateLimit(ip);
  if (wait !== null) throw new RateLimitedError(wait);
  return proved;
}

// NOTEFEED_MAX_FEEDS, for a post that would create the feed. Whether the feed exists.
// ponytail: caps are checked, not locked; concurrent posts can overshoot by a few.
async function feedCapped(feed: string): Promise<boolean> {
  const exists = await hasFeed(feed);
  const maxFeeds = config.maxFeeds();
  if (maxFeeds && !exists && (await feedCount()) >= maxFeeds) throw capReached("feed", new FeedLimitError());
  return exists;
}

// After every check, before the first write: the post that creates the feed with a password creates it protected
// (true: this post did). A password (the feed's `X-Feed-Password`) is set only by the post that creates the feed.
async function protect(feed: string, ip: string, access: FeedAccess, proved: boolean, exists: boolean, given: string | undefined, wantedReadId: string | undefined): Promise<boolean> {
  const password = (access.password ?? given) || undefined; // empty means none
  // A protected feed was already unlocked above; an open existing one can't be claimed.
  if (!proved && password !== undefined) {
    if (exists) throw new FeedExistsError();
    await createProtected(feed, password, wantedReadId);
    return true;
  }
  // The sender decides how long read() takes, and the feed may have been created protected meanwhile:
  // a post that proved nothing above is checked again, with nothing to show.
  if (!proved) await checkFeedAccess(feed, {}, ip);
  return false;
}

// The caps are per type: images have their own, the notes limit counts the markdown ones. `adding` notes of that type; a feed that does not exist yet counts as empty.
async function checkCap(feed: string, typeName: string, adding: number): Promise<void> {
  const image = typeName === "image";
  const max = image ? config.maxImagesPerFeed() : config.maxNotesPerFeed();
  if (adding && max && (await countNotes(feed, typeName)) + adding > max) throw image ? capReached("image", new ImageLimitError()) : capReached("note", new NoteLimitError());
}

// What a post carries: the file (`body`) and the type the poster declared for it (`mediaType`, a Content-Type), with the optional
// metadata (`name` is the file name it came with) and, for the post that creates the feed, a password and a read id.
export type PostInput = { body: Uint8Array; mediaType: string; title?: string; tags?: string[]; alt?: string; name?: string; password?: string; readId?: string };

// `read` runs only once the post is admitted, so a refused request never has its body read.
// A password (the feed's `X-Feed-Password`) is set only by the post that creates the feed.
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
  const proved = await admit(feed, ip, access);
  const exists = await feedCapped(feed);
  const input = await read();
  const parsed = parseMediaType(input.mediaType);
  if (!parsed) throw new UnsupportedTypeError();
  const { type, ext } = parsed;
  if (exists) await checkCap(feed, type.name, 1);
  // Before createProtected: a refused note must not leave a protected, empty feed.
  if (!type.verify(input.body, ext)) throw new UnsupportedTypeError(`the body is not ${parsed.mediaType}`);
  type.checkBody(input.body);
  checkLine("title", input.title, MAX_NOTE_TITLE);
  if (checkLine("alt", input.alt, MAX_ALT) && !type.hasAlt) throw new InvalidBodyError("alt is for image notes");
  const tags = checkTags(input.tags);
  const wantedReadId = exists || !input.readId?.trim() ? undefined : input.readId.trim();
  const created = await protect(feed, ip, access, proved, exists, input.password, wantedReadId);
  // ponytail: checked, not locked. A protected creation can still complete in the few microseconds between
  // this check and createNoteOf's ensureFeed, which then finds the feed and writes into it: this one note is
  // then in the protected feed. A lock around creation, per feed, would close it.
  const made = await createNoteOf(feed, type, ext, input.body, { sender, tags, title: input.title, alt: input.alt, name: input.name, wantedReadId });
  return { ...made, created };
}


// Replacing a note's content, and changing its title or alt text: the same gate as posting, minus the caps.
export async function editContent(feed: string, id: string, ip: string, read: () => Promise<{ body: Uint8Array; mediaType: string }>, access: FeedAccess): Promise<Note> {
  await admit(feed, ip, access);
  const { body, mediaType } = await read();
  const note = await replaceContent(feed, id, body, mediaType);
  if (!note) throw new NotFoundError("no such note");
  return note;
}

export async function editMeta(feed: string, id: string, ip: string, read: () => Promise<{ title?: string; alt?: string }>, access: FeedAccess): Promise<Note> {
  await admit(feed, ip, access);
  const note = await changeMeta(feed, id, await read());
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

export { MAX_ATTACHMENTS }; // defined in shared/links.ts: the web box holds to it too

// A picture sent with a markdown text: `name` is the file name the text refers to it by (`![](name)`), kept with the stored note.
export type Picture = { name: string; body: Uint8Array; mediaType: string; alt?: string };
// A post of a text and its pictures. No `text`: just the pictures, each with the title. `password` and `readId` as in PostInput.
export type PostBundle = { text?: string; pictures: Picture[]; title?: string; tags?: string[]; password?: string; readId?: string };

const MARKDOWN_TYPE = "text/markdown";
const IMAGE_TYPES = MEDIA_TYPES.filter((m) => m.mediaType.startsWith("image/")).map((m) => m.mediaType).join(", ");

// Every check a picture gets before anything is stored; a refusal names it.
function checkPictures(pictures: Picture[]): (Picture & { type: NoteType; ext: string })[] {
  if (pictures.length > MAX_ATTACHMENTS) throw new InvalidBodyError(`at most ${MAX_ATTACHMENTS} attachments`);
  const seen = new Set<string>();
  return pictures.map((p) => {
    try {
      if (!isAttachmentName(p.name)) throw new InvalidBodyError("not a file name: 1 to 200 characters, no / or \\, no control characters, no leading or trailing space");
      if (seen.has(p.name)) throw new InvalidBodyError("the file name is given twice");
      seen.add(p.name);
      const parsed = parseMediaType(p.mediaType);
      if (parsed?.type.name !== "image") throw new UnsupportedTypeError(`send a picture: ${IMAGE_TYPES}`);
      if (p.body.length > config.maxImageBytes()) throw new ImageTooLargeError();
      if (!parsed.type.verify(p.body, parsed.ext)) throw new UnsupportedTypeError(`the body is not ${parsed.mediaType}`);
      parsed.type.checkBody(p.body);
      checkLine("alt", p.alt, MAX_ALT);
      return { ...p, type: parsed.type, ext: parsed.ext };
    } catch (e) {
      if (e instanceof NotefeedError) e.message = `attachment "${p.name}": ${e.message}`;
      throw e;
    }
  });
}

// The text as it will be stored, checked before the pictures are: each picture's place holds a file name as long as its stored one will be.
// ponytail: the length is that of today's ids (`<stamp>-<uuid>`); if they change, the write's own check refuses and the pictures are removed.
function checkText(text: string, pictures: { name: string; ext: string }[]): void {
  const id = `${idStamp(new Date())}-${"0".repeat(36)}`;
  checkMarkdown(placeImages(text, new Map(pictures.map((p) => [p.name, `${id}.${p.ext}`]))));
}

// Stores the pictures in order, then whatever `then` stores (given the stored notes and the map of file name to stored file); if
// any write fails, the pictures stored so far are removed and the error is rethrown. A picture that can't be removed is logged by its
// note id (never the feed: its name is the write key), so an operator can find the stray file.
async function storeWithPictures<T>(feed: string, pictures: (Picture & { type: NoteType; ext: string })[], opts: NewNoteOptions, then: (stored: Note[], sent: Map<string, string>, readId: string | null) => Promise<T>): Promise<T> {
  const stored: Note[] = [];
  try {
    let readId: string | null = null;
    for (const p of pictures) {
      const made = await createNoteOf(feed, p.type, p.ext, p.body, { ...opts, alt: p.alt, name: p.name });
      stored.push(made.note);
      readId = made.readId;
    }
    return await then(stored, new Map(pictures.map((p, i) => [p.name, stored[i].file])), readId);
  } catch (e) {
    await Promise.all(
      stored.map(async (n) => {
        const failed = await removeNote(feed, n.id).then((removed) => (removed ? null : {}), (err: unknown) => ({ err }));
        if (failed) log.error({ note: n.id, ...failed }, "a picture of a failed post could not be removed");
      }),
    );
    throw e;
  }
}

// A markdown text with its pictures, as one post: every check first (the pictures, the text, the caps for the existing notes plus
// these), then the pictures in order, then the text with its references to them swapped for the stored files (placeImages). All or
// nothing: a failed write removes the notes this post stored (the feed stays when this post created it). `note` is the text note, or
// with no text the first picture. The rate limit counts the post once.
export async function postWithPictures(
  feed: string,
  ip: string,
  read: () => Promise<PostBundle>,
  access: FeedAccess,
  sender?: string,
): Promise<{ note: Note; created: boolean; readId: string | null; pictures: Note[] }> {
  const proved = await admit(feed, ip, access);
  const exists = await feedCapped(feed);
  const { text, title, ...input } = await read();
  const pictures = checkPictures(input.pictures);
  if (text === undefined && pictures.length === 0) throw new InvalidBodyError("send a text, pictures or both");
  if (text !== undefined) checkText(text, pictures);
  checkLine("title", title, MAX_NOTE_TITLE);
  const tags = checkTags(input.tags);
  await checkCap(feed, "markdown", text === undefined ? 0 : 1);
  await checkCap(feed, "image", pictures.length);
  const wantedReadId = exists || !input.readId?.trim() ? undefined : input.readId.trim();
  const created = await protect(feed, ip, access, proved, exists, input.password, wantedReadId);
  const opts = { sender, tags, wantedReadId };
  return storeWithPictures(feed, pictures, { ...opts, title: text === undefined ? title : undefined }, async (stored, sent, readId) => {
    if (text === undefined) return { note: stored[0], created, readId, pictures: stored };
    const made = await createNoteOf(feed, MARKDOWN, "md", encoder.encode(placeImages(text, sent)), { ...opts, title });
    return { ...made, created, pictures: stored };
  });
}

// A markdown note's new text with its pictures: the same checks and order as postWithPictures, then the text replaces the note's
// (id, title, sender and tags stay); `tags` and the sender go on the pictures. All or nothing as there.
export async function editWithPictures(
  feed: string,
  id: string,
  ip: string,
  read: () => Promise<{ text: string; pictures: Picture[]; tags?: string[] }>,
  access: FeedAccess,
  sender?: string,
): Promise<{ note: Note; pictures: Note[] }> {
  await admit(feed, ip, access);
  const input = await read();
  const pictures = checkPictures(input.pictures);
  checkText(input.text, pictures);
  const tags = checkTags(input.tags);
  const note = await getNote(feed, id);
  if (!note) throw new NotFoundError("no such note");
  if (note.type !== MARKDOWN_TYPE) throw new UnsupportedTypeError(`this note is ${note.type}: send that Content-Type`);
  await checkCap(feed, "image", pictures.length);
  return storeWithPictures(feed, pictures, { sender, tags }, async (stored, sent) => {
    const edited = await replaceContent(feed, id, encoder.encode(placeImages(input.text, sent)), MARKDOWN_TYPE);
    if (!edited) throw new NotFoundError("no such note");
    return { note: edited, pictures: stored };
  });
}
