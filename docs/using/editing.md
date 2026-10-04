# Editing and deleting notes

A note can be changed or removed after it was posted. All of it uses the note's URL in the API, `/api/v1/feeds/<feed>/notes/<id>`, where `<id>` is the `id` that posting returned.

`PUT` replaces the note's content with the body and answers `200` with the note as it is now. The body has the same rules as posting: a `Content-Type` from [Types](posting.md#types), and a body that is what it declares. A note keeps its type, so the `Content-Type` must be the note's own (`415` otherwise): a markdown note takes markdown, a PNG takes another PNG.

```sh
curl -X PUT -H "Content-Type: text/markdown" --data-binary @note.md \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/notes/20260929T140512Z-backup-finished
```

A markdown note can also be replaced with a `multipart/form-data` `PUT`, to add pictures: the `text` part is required, the `file` parts and `alt.<filename>` are as in [posting a note with its pictures](pictures.md#posting-a-note-with-its-pictures), and the references are swapped the same way. The pictures are new notes of their own; `X-Note-Tags` goes on them only (a raw `PUT` ignores it), and the answer is `200` with the note and `attachments`. The note is looked up before the parts are checked: a missing note is `404` and an image note `415`, whatever the parts hold. It is all or nothing, like a post.

`PATCH` changes the note's [title](titles-and-tags.md#titles) and, for a picture, its alt text, with a JSON body of `title` and/or `alt`. An empty string removes one. It answers `200` with the note:

```sh
curl -X PATCH -H "Content-Type: application/json" -d '{"title": "Backup finished"}' \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/notes/20260929T140512Z-backup-finished
```

`DELETE` removes the note for good and answers `204` with no body. There is no undo and no trash:

```sh
curl -X DELETE \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/notes/20260929T140512Z-backup-finished
```

What to know:

- **Who may:** whoever may post to the feed. On an open feed the name is the key, so anyone who knows it can edit and delete its notes, not only add to them. A feed with [its own password](feed-passwords.md#in-the-api) needs `X-Feed-Password` for all three, and an instance with a password needs `Authorization: Bearer` first, as for posting. The [read link](read-links.md) can neither edit nor delete.
- **The id stays.** A `PUT` keeps the note's id, so its URLs, its place in the feed and its RSS `guid` stay the same. Unless a title was set, a markdown note's title follows the new text. Notes have no edit time and no history: the old content is gone, and the note keeps its original time.
- **A feed reader may not show the change.** Because the `guid` stays, a reader that has already seen the item may keep showing the old text.
- **The feed stays,** even when you delete its last note. Its name and its password remain, and the feed is then empty.
- **Limits:** edits and deletes count toward the same per-client [rate limit](../self-hosting/limits.md#rate-limits-and-caps) as posts. A `PUT` must pass the checks of a post (a markdown note not blank, UTF-8, at most 100 KB; a picture within the size limit). A refused edit leaves the note unchanged.
- **Errors:** `404` (`not_found`) means no note has that id in that feed. That includes a feed that does not exist and an id that could not belong to a note. A protected feed answers `401` before it says anything about its notes. `PATCH` also answers `400` for nothing to change or `alt` on a markdown note. The other statuses are those of posting: `400`, `401`, `413`, `415` and `429`. None of the three creates a feed.
