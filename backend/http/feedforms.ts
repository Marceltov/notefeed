// POST /<feed>/details and /<feed>/delete: the web UI's plain forms for a feed's title, description and deletion.
// Always answers with a redirect: back to the settings page (saved or refused), to the home page after a delete.
import { InvalidBodyError, InvalidRequestError } from "../errors";
import { deleteFeed, updateFeed } from "../posting";
import { settingsPath } from "../urls";
import { feedCookies } from "./feedsession";
import { feedAccess, formPost, readFields, seeOther } from "./request";

const FORM_MAX = 8192; // 100 + 500 characters at up to 4 bytes, plus framing

// `form=details` tells the feed page which of its forms the refusal belongs to.
const refused = (feed: string) => `${settingsPath(feed)}?form=details`;

export const feedSettingsRoute = (req: Request, feed: string): Promise<Response> =>
  formPost(req, feed, refused(feed), async (h, ip) => {
    // Read once the request is admitted, so a refused one never has its body read.
    const read = async () => {
      const form = await readFields(req, FORM_MAX);
      if (!form) throw new InvalidBodyError("form needs title and description");
      // The checkbox is only on the page while identity is on; without its marker the setting stays as it is.
      return { title: form.get("title"), description: form.get("description"), showSender: form.has("show_sender_present") ? form.has("show_sender") : undefined };
    };
    await updateFeed(feed, ip, read, feedAccess(h, feed));
    return seeOther(`${settingsPath(feed)}?saved=1`);
  });

export function feedDeleteRoute(req: Request, feed: string): Promise<Response> {
  // The unlock cookies of a deleted feed are of no use any more.
  const gone = (h: Headers) => seeOther(`/?deleted=${encodeURIComponent(feed)}`, feedCookies(h, feed, "", 0));
  return formPost(
    req,
    feed,
    refused(feed),
    async (h, ip) => {
      if ((await readFields(req, FORM_MAX))?.get("confirm") !== feed) throw new InvalidRequestError("type the feed's name to confirm");
      await deleteFeed(feed, ip, feedAccess(h, feed));
      return gone(h);
    },
    () => gone(req.headers),
  );
}
