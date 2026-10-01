// POST /<feed>/<id>/edit and /<feed>/<id>/delete: the web UI's plain forms for changing a note.
// Always answers with a redirect: back to the note on success (edit) or refusal, to the feed after a delete.
import { AuthError, InvalidBodyError, NotefeedError } from "../errors";
import { assertFeed } from "../feeds";
import { clientIp } from "../limits";
import { deleteNote, editNote } from "../posting";
import { feedPath } from "../urls";
import { errorResponse } from "./errors";
import { readMarkdown } from "./notes";
import { authorize, errorRedirect, feedAccess, mediaType, sameOrigin, seeOther } from "./request";

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
        // Multipart, like the compose box: a urlencoded body is a third bigger for non-ASCII text and
        // readMarkdown would take it for raw markdown.
        if (mediaType(h) !== "multipart/form-data") throw new InvalidBodyError("form must be multipart");
        return readMarkdown(req);
      },
      feedAccess(h, feed),
    );
    return seeOther(`${note}?edited=1`);
  } catch (e) {
    if (!(e instanceof NotefeedError)) throw e;
    if (["invalid_feed", "reserved_feed"].includes(e.code)) return errorResponse(e);
    // Already deleted (a double click on the form): the goal is met.
    if (action === "delete" && e.code === "not_found") return seeOther(`${feedPath(feed)}?deleted=${encodeURIComponent(id)}`);
    return errorRedirect(note, e);
  }
}
