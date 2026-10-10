// The backend's boundary: the only module the frontend (app/, components/, proxy.ts) may import from
// backend/ (enforced in eslint.config.mjs). Calls are in-process today. Each query below is shaped like
// the endpoint it would become if the backend moved out, so the cut would be here and nowhere else.
import { config } from "./config";
import { identityOn, providers } from "./oidc/config";
import { forReaders, getSettings } from "./feedsettings";
import { isReadId, checkFeed, feedForReadId, hasFeed, readIdOf } from "./feeds";
import { countNotes, getNote, ImageNote, listNotes, MarkdownNote, type Note } from "./notes";
import { imagePath } from "./urls";

// The notes the backend hands out; the classes are exported so a component test can build one.
export { ImageNote, MarkdownNote };
export type { Note };
export { IDENTITY_COOKIE, SESSION_COOKIE, identitySender, locked, sessionOk } from "./auth";
export { checkFeed, isHeldBack as isReservedFeed, readIdOf } from "./feeds";
export { identityOn };
export { feedPath, publicUrl, readPath, rssPath, safeNext, settingsPath } from "./urls";
// Every write is one of these HTTP handlers; the frontend only mounts them and renders.
export { dispatch } from "./http/api";
export { measured } from "./metrics";
export { noteOutcome } from "./requestscope";
export { hasLegalPage, readLegalPage, readNotice, type LegalPage } from "./legal";
export { metricsRoute } from "./http/metrics";
export { moveImagesRoute, unreferencedImagesRoute } from "./http/operator";
export { feedCookieName, feedUnlocked } from "./feedlock";
export { feedDeleteRoute, feedSettingsRoute } from "./http/feedforms";
export { feedAccessRoute } from "./http/feedsession";
export { loginRoute, logoutRoute } from "./http/session";
export { fileRoute } from "./http/files";
export { rssRoute } from "./http/rss";
export { mcpRoute } from "./mcp";
export { oidcCallbackRoute, oidcStartRoute } from "./oidc/routes";
export { authServerRoute, authorizeRoute, checkAuthorize, metadataPreflight, protectedResourceRoute, registerPreflight, registerRoute, tokenRoute } from "./oauth/routes";

export const instanceTitle = config.title;

/** The sign-in providers for the buttons, in order: id (for /api/oidc/start?provider=) and label; empty while identity is off. */
export const signInProviders = (): { id: string; label: string }[] => providers().map(({ id, label }) => ({ id, label }));

/** Whether the instance password is set (sign-in alone can lock an instance too). */
export const passwordSet = () => config.password() !== "";

/** Whether a feed's owner may choose its read id (NOTEFEED_ALLOW_CUSTOM_IDS); otherwise only a random one. */
export const customIdsOn = config.allowCustomIds;

const PAGE = 50;

/**
 * A feed by its (writable) name: newest notes and its read id; null for an invalid or reserved name.
 * No read id while the feed has no notes: a name nobody has posted to has no feed (and no id) yet, and a
 * legacy feed's id is derived from the name, so showing one would hand out the read link of whatever
 * feed is created there later. None either for a feed whose stored read id can't be read (backend/feeds.ts).
 */
export async function getFeed(feed: string, tag?: string): Promise<{ notes: Note[]; readId: string | null; exists: boolean; title: string; description: string; image: string; showSender: boolean; imageUrl: string | null } | null> {
  if (checkFeed(feed)) return null;
  const notes = await listNotes(feed, PAGE, undefined, tag);
  // `exists`: a feed that had notes and lost them still exists (it counts toward the feed cap and can't get a password).
  const readId = (await countNotes(feed)) ? await readIdOf(feed) : null; // not notes.length: a tag filter can show none of a feed's notes
  const settings = await getSettings(feed);
  // The title image's path under the read id (it is served there, never under the feed's name).
  return { notes, readId, exists: await hasFeed(feed), ...settings, imageUrl: readId && settings.image ? imagePath(readId, settings.image) : null };
}

/** A feed's image notes, newest first (at most 50), for choosing its title image: the file and its path under the read id. */
export async function getFeedImages(feed: string): Promise<{ file: string; url: string; title: string }[]> {
  if (checkFeed(feed)) return [];
  const readId = await readIdOf(feed);
  if (!readId) return [];
  return (await listNotes(feed, PAGE, undefined, undefined, "image")).map((n) => ({ file: n.file, url: imagePath(readId, n.file), title: n.title }));
}

export async function getFeedNote(feed: string, id: string): Promise<Note | null> {
  return getNote(feed, id); // null for an invalid or reserved feed name too
}

/** A feed by its read id: null for a malformed id; an unknown one is an empty feed, so ids can't be probed. */
export async function getReadFeed(id: string, tag?: string): Promise<{ notes: Note[]; title: string; description: string; imageUrl: string | null } | null> {
  if (!isReadId(id)) return null;
  const feed = await feedForReadId(id);
  const settings = feed ? await getSettings(feed) : { title: "", description: "", image: "", showSender: true };
  const { title, description, image } = settings;
  return { notes: feed ? forReaders(await listNotes(feed, PAGE, undefined, tag), settings) : [], title, description, imageUrl: image ? imagePath(id, image) : null };
}

export async function getReadNote(readId: string, id: string): Promise<Note | null> {
  const feed = await feedForReadId(readId);
  const note = feed ? await getNote(feed, id) : null;
  return note && feed ? forReaders([note], await getSettings(feed))[0] : null;
}
