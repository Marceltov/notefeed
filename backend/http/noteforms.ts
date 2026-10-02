// POST /<feed>/<id>/edit and /<feed>/<id>/delete: the web UI's plain forms for changing a note.
// Always answers with a redirect: back to the note on success (edit) or refusal, to the feed after a delete.
import { InvalidBodyError } from "../errors";
import { deleteNote, editNote } from "../posting";
import { feedPath } from "../urls";
import { readMarkdown } from "./notes";
import { feedAccess, formPost, mediaType, seeOther } from "./request";

export async function noteFormRoute(req: Request, feed: string, id: string, action: string): Promise<Response> {
  if (action !== "edit" && action !== "delete") return new Response("Not found", { status: 404 });
  const note = `${feedPath(feed)}/${encodeURIComponent(id)}`;
  if (action === "delete") {
    const deleted = () => seeOther(`${feedPath(feed)}?deleted=${encodeURIComponent(id)}`);
    return formPost(req, feed, note, async (h, ip) => (await deleteNote(feed, id, ip, feedAccess(h, feed)), deleted()), deleted);
  }
  return formPost(req, feed, note, async (h, ip) => {
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
  });
}
