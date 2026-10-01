// POST /<feed>/access: the web UI's plain forms for a feed password (unlock, lock, change, remove).
// Always answers with a redirect back to the feed page; the cookie is the feed's unlock cookie.
import { AuthError, InvalidRequestError, NotefeedError, RateLimitedError } from "../errors";
import { changePassword, cookieValue, feedCookieName, protectedFeed, removePassword, unlock } from "../feedlock";
import { assertFeed } from "../feeds";
import { clientIp } from "../limits";
import { feedPath, publicUrl } from "../urls";
import { errorResponse } from "./errors";
import { parseForm, readCapped, sameOrigin, seeOther } from "./request";

const YEAR = 60 * 60 * 24 * 365;

// The unlock cookie's header; an empty value with age 0 clears it. Secure behind https.
export function feedCookie(h: Headers, feed: string, value: string, age = YEAR): Record<string, string> {
  const secure = publicUrl(h).startsWith("https:") ? "; Secure" : "";
  return { "Set-Cookie": `${feedCookieName(feed)}=${value}; Path=/${feed}; Max-Age=${age}; HttpOnly; SameSite=Lax${secure}` };
}

export async function feedAccessRoute(req: Request, feed: string): Promise<Response> {
  const h = req.headers;
  const page = feedPath(feed);
  const set = (value: string) => feedCookie(h, feed, value);
  const clear = () => feedCookie(h, feed, "", 0);
  try {
    assertFeed(feed); // before anything touches the disk
    const bytes = await readCapped(req, 4096);
    const form = bytes ? await parseForm(bytes, h).catch(() => null) : null;
    const field = (name: string) => String(form?.get(name) ?? "");
    const action = field("action");
    if (!["unlock", "lock", "change", "remove"].includes(action)) throw new InvalidRequestError("unknown action");
    if (action === "unlock") {
      if (!(await protectedFeed(feed))) return seeOther(page);
      return seeOther(page, set(await unlock(feed, field("password"), clientIp(h))));
    }
    // These use the cookie's session, so only this instance's own pages may send them.
    if (!sameOrigin(h)) throw new AuthError();
    if (action === "lock") return seeOther(page, clear());
    if (action === "remove") {
      await removePassword(feed, field("current"), clientIp(h));
      return seeOther(page, clear());
    }
    await changePassword(feed, field("current"), field("next"), clientIp(h));
    return seeOther(page, set((await cookieValue(feed)) ?? ""));
  } catch (e) {
    if (!(e instanceof NotefeedError)) throw e;
    if (["invalid_feed", "reserved_feed", "invalid_request"].includes(e.code)) return errorResponse(e);
    const retry = e instanceof RateLimitedError ? `&retry=${e.retryAfter}` : "";
    return seeOther(`${page}?error=${e.code}${retry}`);
  }
}
