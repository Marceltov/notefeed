// The backend's boundary: the only module the frontend (app/, components/, proxy.ts) may import from
// backend/ (enforced in eslint.config.mjs). Calls are in-process today. Each query below is shaped like
// the endpoint it would become if the backend moved out, so the cut would be here and nowhere else.
import { config } from "./config";
import { getSettings } from "./feedsettings";
import { isReadId, checkFeed, feedForReadId, hasFeed, readIdOf } from "./feeds";
import { getNote, listNotes, type Note } from "./notes";
import { imagePath } from "./urls";

export type { Note };
export { SESSION_COOKIE, locked, sessionOk } from "./auth";
export { checkFeed } from "./feeds";
export { feedPath, publicUrl, readPath, rssPath, safeNext } from "./urls";
// Every write is one of these HTTP handlers; the frontend only mounts them and renders.
export { dispatch } from "./http/api";
export { feedCookieName, feedUnlocked } from "./feedlock";
export { feedDeleteRoute, feedSettingsRoute } from "./http/feedforms";
export { feedAccessRoute } from "./http/feedsession";
export { noteFormRoute } from "./http/noteforms";
export { loginRoute, logoutRoute } from "./http/session";
export { imageRoute } from "./http/images";
export { rssRoute } from "./http/rss";
export { mcpRoute } from "./mcp";
export { authServerRoute, authorizeRoute, checkAuthorize, metadataPreflight, protectedResourceRoute, registerPreflight, registerRoute, tokenRoute } from "./oauth/routes";

export const instanceTitle = config.title;

const PAGE = 50;

/**
 * A feed by its (writable) name: newest notes and its read id; null for an invalid or reserved name.
 * No read id while the feed has no notes: a name nobody has posted to has no feed (and no id) yet, and a
 * legacy feed's id is derived from the name, so showing one would hand out the read link of whatever
 * feed is created there later. None either for a feed whose stored read id can't be read (backend/feeds.ts).
 */
export async function getFeed(feed: string): Promise<{ notes: Note[]; readId: string | null; exists: boolean; title: string; description: string; image: string; imageUrl: string | null } | null> {
  if (checkFeed(feed)) return null;
  const notes = await listNotes(feed, PAGE);
  // `exists`: a feed that had notes and lost them still exists (it counts toward the feed cap and can't get a password).
  const readId = notes.length ? await readIdOf(feed) : null;
  const settings = await getSettings(feed);
  // The title image's path under the read id (it is served there, never under the feed's name).
  return { notes, readId, exists: await hasFeed(feed), ...settings, imageUrl: readId && settings.image ? imagePath(readId, settings.image) : null };
}

export async function getFeedNote(feed: string, id: string): Promise<Note | null> {
  return getNote(feed, id); // null for an invalid or reserved feed name too
}

/** A feed by its read id: null for a malformed id; an unknown one is an empty feed, so ids can't be probed. */
export async function getReadFeed(id: string): Promise<{ notes: Note[]; title: string; description: string; imageUrl: string | null } | null> {
  if (!isReadId(id)) return null;
  const feed = await feedForReadId(id);
  const { title, description, image } = feed ? await getSettings(feed) : { title: "", description: "", image: "" };
  return { notes: feed ? await listNotes(feed, PAGE) : [], title, description, imageUrl: image ? imagePath(id, image) : null };
}

export async function getReadNote(readId: string, id: string): Promise<Note | null> {
  const feed = await feedForReadId(readId);
  return feed ? getNote(feed, id) : null;
}
