// POST /<feed>/<id>/edit and /<feed>/<id>/delete: the web UI's plain forms for changing a note.
// Always answers with a redirect: back to the note on success (edit) or refusal, to the feed after a delete.
import { InvalidBodyError, NoteTooLargeError, NotefeedError, RateLimitedError, AuthError } from "../errors";
import { assertFeed } from "../feeds";
import { clientIp } from "../limits";
import { MAX_BYTES } from "../notes";
import { deleteNote, editNote } from "../posting";
import { feedPath } from "../urls";
import { errorResponse } from "./errors";
import { authorize, feedAccess, parseForm, readCapped, sameOrigin, seeOther } from "./request";

export async function noteFormRoute(req: Request, feed: string, id: string, action: string): Promise<Response> {
  if (action !== "edit" && action !== "delete") return new Response("Not found", { status: 404 });
  const h = req.headers;
  const note = `${feedPath(feed)}/${encodeURIComponent(id)}`;
  try {
    assertFeed(feed); // before anything touches the disk
    // Only this instance's own pages may send these: another site's form must not edit with a visitor's cookies.
    if (!sameOrigin(h)) throw new AuthError();
    const ip = clientIp(h);
    authorize(h, ip);
    if (action === "delete") {
      await deleteNote(feed, id, ip, feedAccess(h, feed));
      return seeOther(`${feedPath(feed)}?deleted=${encodeURIComponent(id)}`);
    }
    await editNote(
      feed,
      id,
      ip,
      async () => {
        const bytes = await readCapped(req, MAX_BYTES);
        if (!bytes) throw new NoteTooLargeError();
        const form = await parseForm(bytes, h).catch(() => null);
        const markdown = form?.get("markdown");
        if (typeof markdown !== "string") throw new InvalidBodyError('form needs a "markdown" field');
        return { markdown };
      },
      feedAccess(h, feed),
    );
    return seeOther(`${note}?edited=1`);
  } catch (e) {
    if (!(e instanceof NotefeedError)) throw e;
    if (["invalid_feed", "reserved_feed"].includes(e.code)) return errorResponse(e);
    const retry = e instanceof RateLimitedError ? `&retry=${e.retryAfter}` : "";
    return seeOther(`${note}?error=${e.code}${retry}`);
  }
}
