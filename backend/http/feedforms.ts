// POST /<feed>/settings and /<feed>/delete: the web UI's plain forms for a feed's title, description and deletion.
// Always answers with a redirect: back to the feed page (saved or refused), to the home page after a delete.
import { AuthError, InvalidBodyError, InvalidRequestError, NotefeedError } from "../errors";
import { assertFeed } from "../feeds";
import { clientIp } from "../limits";
import { deleteFeed, updateFeed } from "../posting";
import { feedPath } from "../urls";
import { errorResponse } from "./errors";
import { feedCookies } from "./feedsession";
import { authorize, errorRedirect, feedAccess, readFields, sameOrigin, seeOther } from "./request";

const FORM_MAX = 8192; // 100 + 500 characters at up to 4 bytes, plus framing

// Runs `act` once the post is known to come from this instance's own page by someone who may change the feed.
async function run(req: Request, feed: string, act: (h: Headers, ip: string) => Promise<Response>, onGone?: () => Response) {
  const h = req.headers;
  try {
    assertFeed(feed); // before anything touches the disk
    // Only this instance's own pages may send these: another site's form must not change a feed with a visitor's cookies.
    if (!sameOrigin(h)) throw new AuthError();
    const ip = clientIp(h);
    authorize(h, ip);
    return await act(h, ip);
  } catch (e) {
    if (!(e instanceof NotefeedError)) throw e;
    if (["invalid_feed", "reserved_feed"].includes(e.code)) return errorResponse(e);
    if (e.code === "not_found" && onGone) return onGone(); // already deleted (a double click): the goal is met
    return errorRedirect(feedPath(feed), e);
  }
}

export const feedSettingsRoute = (req: Request, feed: string): Promise<Response> =>
  run(req, feed, async (h, ip) => {
    // Read once the request is admitted, so a refused one never has its body read.
    const read = async () => {
      const form = await readFields(req, FORM_MAX);
      if (!form) throw new InvalidBodyError("form needs title and description");
      return { title: form.get("title"), description: form.get("description") };
    };
    await updateFeed(feed, ip, read, feedAccess(h, feed));
    return seeOther(`${feedPath(feed)}?saved=1`);
  });

export function feedDeleteRoute(req: Request, feed: string): Promise<Response> {
  // The unlock cookies of a deleted feed are of no use any more.
  const gone = (h: Headers) => seeOther(`/?deleted=${encodeURIComponent(feed)}`, feedCookies(h, feed, "", 0));
  return run(
    req,
    feed,
    async (h, ip) => {
      if ((await readFields(req, FORM_MAX))?.get("confirm") !== feed) throw new InvalidRequestError("type the feed's name to confirm");
      await deleteFeed(feed, ip, feedAccess(h, feed));
      return gone(h);
    },
    () => gone(req.headers),
  );
}
