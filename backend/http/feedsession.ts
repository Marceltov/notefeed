// POST /<feed>/access: the web UI's plain forms for a feed password (unlock, lock, change, remove).
// Always answers with a redirect back to the feed page (unlock, lock) or the settings page (change, remove); the cookie is the feed's unlock cookie.
import { AuthError, InvalidRequestError, NotefeedError } from "../errors";
import { changePassword, feedCookieName, protectedFeed, removePassword, unlock } from "../feedlock";
import { assertLive } from "../feeds";
import { clientIp } from "../limits";
import { API_PREFIX, feedPath, publicUrl, settingsPath } from "../urls";
import { errorResponse } from "./errors";
import { errorRedirect, parseForm, readCapped, sameOrigin, seeOther } from "./request";

const YEAR = 60 * 60 * 24 * 365;

// The unlock cookie as Set-Cookie headers; an empty value with age 0 clears it. Set twice, for the page's
// path and for the feed's API path, because the web UI's fetch() calls /api/v1/feeds/<feed>/...; both
// match on a "/" boundary, so feed foo's cookie never reaches foobar. Secure behind https.
export function feedCookies(h: Headers, feed: string, value: string, age = YEAR): [string, string][] {
  const secure = publicUrl(h).startsWith("https:") ? "; Secure" : "";
  return [`/${feed}`, `${API_PREFIX}/feeds/${feed}`].map((path) => [
    "Set-Cookie",
    `${feedCookieName(feed)}=${value}; Path=${path}; Max-Age=${age}; HttpOnly; SameSite=Lax${secure}`,
  ]);
}

export async function feedAccessRoute(req: Request, feed: string): Promise<Response> {
  const h = req.headers;
  const page = feedPath(feed);
  const set = (value: string) => feedCookies(h, feed, value);
  const clear = () => feedCookies(h, feed, "", 0);
  let back = page; // where a refusal goes: the form it came from
  try {
    await assertLive(feed); // before anything touches the disk
    const bytes = await readCapped(req, 4096);
    const form = bytes ? await parseForm(bytes, h).catch(() => null) : null;
    const field = (name: string) => String(form?.get(name) ?? "");
    const action = field("action");
    if (!["unlock", "lock", "change", "remove"].includes(action)) throw new InvalidRequestError("unknown action");
    if (action === "change" || action === "remove") back = settingsPath(feed);
    // Only this instance's own pages may send these: they set, use or drop the cookie's session, and another
    // site's form must not spend a visitor's password attempts either.
    if (!sameOrigin(h)) throw new AuthError();
    if (action === "unlock") {
      if (!(await protectedFeed(feed))) return seeOther(page);
      return seeOther(page, set(await unlock(feed, field("password"), clientIp(h))));
    }
    if (action === "lock") return seeOther(page, clear());
    if (action === "remove") {
      await removePassword(feed, field("current"), clientIp(h));
      return seeOther(page, clear()); // the feed is open now: its settings page would redirect anyway
    }
    return seeOther(`${settingsPath(feed)}?saved=1`, set(await changePassword(feed, field("current"), field("next"), clientIp(h))));
  } catch (e) {
    if (!(e instanceof NotefeedError)) throw e;
    if (["invalid_feed", "reserved_feed", "invalid_request"].includes(e.code)) return errorResponse(e);
    return errorRedirect(back, e);
  }
}
