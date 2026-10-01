// The backend's boundary: the only module the frontend (app/, components/, proxy.ts) may import from
// backend/ (enforced in eslint.config.mjs). Calls are in-process today. Each query below is shaped like
// the endpoint it would become if the backend moved out, so the cut would be here and nowhere else.
import { config } from "./config";
import { READ_ID_RE, checkFeed, feedForReadId, hasFeed, readId } from "./feeds";
import { getNote, listNotes, type Note } from "./notes";

export type { Note };
export { SESSION_COOKIE, locked, sessionOk } from "./auth";
export { checkFeed } from "./feeds";
export { feedPath, publicUrl, readPath, rssPath, safeNext } from "./urls";
// Every write is one of these HTTP handlers; the frontend only mounts them and renders.
export { dispatch } from "./http/api";
export { feedCookieName, feedUnlocked } from "./feedlock";
export { feedAccessRoute } from "./http/feedsession";
export { noteFormRoute } from "./http/noteforms";
export { loginRoute, logoutRoute } from "./http/session";
export { rssRoute } from "./http/rss";
export { mcpRoute } from "./mcp";
export { authServerRoute, authorizeRoute, checkAuthorize, metadataPreflight, protectedResourceRoute, registerPreflight, registerRoute, tokenRoute } from "./oauth/routes";

export const instanceTitle = config.title;

const PAGE = 50;

/**
 * A feed by its (writable) name: newest notes and its read id; null for an invalid or reserved name.
 * No read id while the feed has no notes: it is derived from the name, so showing it for a name nobody
 * has posted to yet would hand out the read link of whatever feed is created there later.
 */
export async function getFeed(feed: string): Promise<{ notes: Note[]; readId: string | null; exists: boolean } | null> {
  if (checkFeed(feed)) return null;
  const notes = await listNotes(feed, PAGE);
  // `exists`: a feed that had notes and lost them still exists (it counts toward the feed cap and can't get a password).
  return { notes, readId: notes.length ? readId(feed) : null, exists: await hasFeed(feed) };
}

export async function getFeedNote(feed: string, id: string): Promise<Note | null> {
  return getNote(feed, id); // null for an invalid or reserved feed name too
}

/** A feed by its read id: null for a malformed id; an unknown one is an empty feed, so ids can't be probed. */
export async function getReadFeed(id: string): Promise<{ notes: Note[] } | null> {
  if (!READ_ID_RE.test(id)) return null;
  const feed = await feedForReadId(id);
  return { notes: feed ? await listNotes(feed, PAGE) : [] };
}

export async function getReadNote(readId: string, id: string): Promise<Note | null> {
  const feed = await feedForReadId(readId);
  return feed ? getNote(feed, id) : null;
}
