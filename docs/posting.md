# Posting notes

A note is a file. Post its bytes to `POST /<feed>`, and say in `Content-Type` what kind of file it is:

```sh
curl -H "Content-Type: text/markdown" --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz
```

`POST /<feed>` is the short form of `POST /api/v1/feeds/<feed>/notes`; both behave the same. To read notes back as JSON, see the [REST API](api.md). The kinds of file a note can be are in [Types](#types): markdown, and the picture formats PNG, JPEG, GIF and WebP (see [Pictures](#pictures)).

A note posted with the password has no sender. Only a person signed in through [sign-in](identity.md), which is opt-in, posts with one.

The feed is created by its first note; there's nothing to set up first. The file on disk is the body exactly as posted, and so is what the API returns: the note's metadata (sender, tags, title) is kept in a small file next to it, never inside the text, so a `---` block you type at the start of a body is body text. notefeed answers `201 Created`:

```json
{
  "id": "20260929T140512Z-backup-finished",
  "url": "https://notes.example.com/homelab-7f3k2q9x4m8wz/20260929T140512Z-backup-finished",
  "feed_url": "https://notes.example.com/homelab-7f3k2q9x4m8wz",
  "read_url": "https://notes.example.com/r/q2Zc9kD0bTnVx4LmAe7sWp/feed.xml",
  "file": "20260929T140512Z-backup-finished.md",
  "file_url": "https://notes.example.com/r/q2Zc9kD0bTnVx4LmAe7sWp/20260929T140512Z-backup-finished.md"
}
```

- `url`: the note's page in the web UI.
- `feed_url`: the feed's page in the web UI.
- `read_url`: the feed's read-only RSS link, for feed readers and for sharing. See [Read links and RSS](feed.md). It is `null` only for [a feed without a read link](operations.md#a-feed-without-a-read-link).
- `file`: the note's file name, `<id>.<extension>`; `file_url`: where that file is served, under the read id (`null` in the same case as `read_url`).

!!! tip "Use `--data-binary`, not `-d`"
    `curl -d` strips newlines from files. `--data-binary` sends the file unchanged. Either way, set the `Content-Type`: without it curl sends `application/x-www-form-urlencoded`, which notefeed refuses with `415` and a message naming the types to send.

## Editing and deleting notes

A note can be changed or removed after it was posted. All of it uses the note's URL in the API, `/api/v1/feeds/<feed>/notes/<id>`, where `<id>` is the `id` that posting returned.

`PUT` replaces the note's content with the body and answers `200` with the note as it is now. The body has the same rules as posting: a `Content-Type` from [Types](#types), and a body that is what it declares. A note keeps its type, so the `Content-Type` must be the note's own (`415` otherwise): a markdown note takes markdown, a PNG takes another PNG.

```sh
curl -X PUT -H "Content-Type: text/markdown" --data-binary @note.md \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/notes/20260929T140512Z-backup-finished
```

A markdown note can also be replaced with a `multipart/form-data` `PUT`, to add pictures: the `text` part is required, the `file` parts and `alt.<filename>` are as in [posting a note with its pictures](#posting-a-note-with-its-pictures), and the references are swapped the same way. The pictures are new notes of their own; `X-Note-Tags` goes on them only, and the answer is `200` with the note and `attachments`. It is all or nothing, like a post.

`PATCH` changes the note's [title](#titles) and, for a picture, its alt text, with a JSON body of `title` and/or `alt`. An empty string removes one. It answers `200` with the note:

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

- **Who may:** whoever may post to the feed. On an open feed the name is the key, so anyone who knows it can edit and delete its notes, not only add to them. A feed with [its own password](#a-feed-with-its-own-password) needs `X-Feed-Password` for all three, and an instance with a password needs `Authorization: Bearer` first, as for posting. The [read link](feed.md) can neither edit nor delete.
- **The id stays.** A `PUT` keeps the note's id, so its URLs, its place in the feed and its RSS `guid` stay the same. Unless a title was set, a markdown note's title follows the new text. Notes have no edit time and no history: the old content is gone, and the note keeps its original time.
- **A feed reader may not show the change.** Because the `guid` stays, a reader that has already seen the item may keep showing the old text.
- **The feed stays,** even when you delete its last note. Its name and its password remain, and the feed is then empty.
- **Limits:** edits and deletes count toward the same per-client [rate limit](configuration.md#rate-limits-and-caps) as posts. A `PUT` must pass the checks of a post (a markdown note not blank, UTF-8, at most 100 KB; a picture within the size limit). A refused edit leaves the note unchanged.
- **Errors:** `404` (`not_found`) means no note has that id in that feed. That includes a feed that does not exist and an id that could not belong to a note. A protected feed answers `401` before it says anything about its notes. `PATCH` also answers `400` for nothing to change or `alt` on a markdown note. The other statuses are those of posting: `400`, `401`, `413`, `415` and `429`. None of the three creates a feed.

## Titles

Every note can have a title of its own, up to 100 characters on one line. A title holds no control characters (U+0080 to U+009F included), no line or paragraph separator (U+2028, U+2029) and no text-direction override characters (U+202A to U+202E, U+2066 to U+2069), or it is `400`; right-to-left text and its marks are fine. The same goes for a picture's alternative text. What an older version stored, or was edited by hand, is shown with each of those characters replaced by a space (titles, alt texts, senders and a feed's title and description, in the web UI, the API, RSS and MCP). Without one, a markdown note is titled by its first heading or first line, and a note that starts with a picture by that picture's alt text; a picture without one shows as the picture. To set one when you post, send the `X-Note-Title` header; later, `PATCH` it. In the web UI it is the **Title** field of the compose box and of the editor. The title is metadata, not part of the file: replacing the content leaves it, and an empty title removes it so the title follows the text again.

## Tags

A note can carry tags: short labels that say what it is, such as `ci`, `deploy` or `failed`, so readers and tools can tell notes apart and filter them. Set them when you post, in the `X-Note-Tags` header:

```bash
curl -H "Content-Type: text/markdown" -H "X-Note-Tags: ci,deploy" --data-binary '# Deploy finished' "$NOTEFEED_URL/$FEED"
```

- **Where:** the `X-Note-Tags` header, comma-separated. An empty header is no tags.
- **Rules:** at most 10 tags per note, each 1 to 32 characters of lowercase letters, digits, `-`, `_`, `.` and `:` (so `env:prod` works). Capitals are folded to lowercase and duplicates are dropped. Anything else is a `400` (`invalid_body`) that names the tag.
- **Not verified:** tags are free labels set by whoever posts. They are no identity and give no access, and `source:github-actions` is a convention you choose, not something notefeed checks. They are shown on the public read link and in RSS like the note itself, and a feed's **Show who posted** setting does not hide them.
- **Where they show:** the `tags` array of the note in the API (an empty list for a note without any, including every note posted before tags existed), the [web UI](web-ui.md#tags), the [MCP](mcp.md) tools, and the RSS item as one `<category>` per tag.
- **Filtering:** `?tag=ci` on the note list (`GET /api/v1/feeds/<feed>/notes`, the read API, the feed page and the read-only page) and on the RSS feed (`/r/<read id>/feed.xml?tag=ci`), so a reader can subscribe to one kind of note. A tag nobody used gives an empty list.
- **Editing:** a `PUT` keeps the note's tags; there is no way to change them after posting.
- **Stored** in the note's metadata file, as `tags: ["ci","deploy"]` (see [Operations](operations.md#where-notes-live)).

## Pictures

A picture is a note of its own: post it with its own `Content-Type` (or with a note, in [one multipart request](#posting-a-note-with-its-pictures)), and it is stored next to the markdown notes, listed in the feed, shown in the read-only view and sent to RSS readers as an enclosure. A markdown note can show it too, by writing `![](<file>)` with the `file` that the post returned.

```sh
curl -H "Content-Type: image/png" --data-binary @photo.png https://notes.example.com/homelab-7f3k2q9x4m8wz
```

The answer is the same as for any note, with the picture's `file` and `file_url` (see above). `X-Note-Alt` sets its alternative text (one line, at most 500 characters, with no control or text-direction override characters, like a [title](#titles)), `X-Note-Name` keeps the original file name (without `/`, `\`, control characters, line separators and text-direction override characters, trimmed, at most 200 characters), and `X-Note-Title` and `X-Note-Tags` work as for markdown. Non-ASCII text in these headers is sent as its UTF-8 bytes, which curl and the client packages do.

What to know:

- **Types:** `image/png`, `image/jpeg`, `image/gif` and `image/webp`. notefeed does not trust the declaration: the body must carry the signature of the declared format, so a JPEG sent as `image/png` is `415`. SVG is not accepted, because it can carry script.
- **Size:** at most 5 MiB (5242880 bytes) by default, set with `NOTEFEED_MAX_IMAGE_BYTES`. An optional cap on the number of pictures per feed is `NOTEFEED_MAX_IMAGES_PER_FEED`, off by default; pictures do not count toward `NOTEFEED_MAX_NOTES_PER_FEED`. See [Configuration](configuration.md#rate-limits-and-caps).
- **Stored as sent.** The picture is kept byte for byte: no resizing, no re-encoding, and no metadata removed. A photo's EXIF data, which can include where it was taken, stays in the file, and the file is public (see below). Remove it before you post if that matters.
- **Who may post:** whoever may post to the feed, in the same order as for a note: the instance password, then the [feed's password](#a-feed-with-its-own-password). Posts count toward the same per-client [rate limit](configuration.md#rate-limits-and-caps). The first picture can create the feed, with a password, like a first note.
- **`![](file)` follows the read id.** In a markdown note, `![](file)` shows the picture from the feed's current read link, so it keeps working if the read id changes. A full URL (`![](https://…)`) is shown as written and is yours to update.
- **Pictures are as public as the read link.** A picture is served under the feed's read id, `/r/<read id>/<file>`, with no password, even on a locked instance or a protected feed, so that it shows in the read-only view and in feed readers, which have no password to send. Anyone who has the read link, or the file's URL, can fetch it, and the feed's name never appears in the URL. Don't post anything you would not give to everyone who has the read link.
- **Deleting and editing.** A picture is deleted like any note (`DELETE` on its URL), which removes the file. Replace its bytes with `PUT` (another image of the same type) and change its title or alt text with `PATCH`.
- **Errors:** those of posting. `415` (`unsupported_type`) is also the answer to an empty body or to bytes that are not that format; `507` (`image_limit`) means the feed already has `NOTEFEED_MAX_IMAGES_PER_FEED` pictures.

In the browser, the compose box and the note editor take pictures with the [Add image](web-ui.md#adding-an-image) button, by paste or by drop.

## Posting a note with its pictures

A note with its pictures is one `multipart/form-data` request, to `POST /<feed>` (or `/api/v1/feeds/<feed>/notes`). The [clients](clients.md#from-code), the `notefeed post --attach` command, the [web UI](web-ui.md#adding-an-image) and the [MCP](mcp.md) `post_note` tool all send it. It is the one exception to one raw file per request:

```sh
curl -F "text=@note.md;type=text/markdown" -F "file=@chart.png;type=image/png" -F "file=@photo.jpg;type=image/jpeg" \
  -F "alt.chart.png=Disk use over a week" https://notes.example.com/homelab-7f3k2q9x4m8wz
```

The parts:

- **`text`:** at most one, the markdown. It is a plain string field or a file part. A file part is stored byte for byte and is what the clients send, because `FormData` rewrites `\n` to `\r\n` in string fields. The type of a file part may be `text/markdown`, empty or `application/octet-stream` (curl labels a `.md` file that way). Required on a `PUT`.
- **`file`:** 0 to 10, the pictures. The file name is the name the markdown refers to; the type must be an accepted [picture type](#pictures), and the server checks the bytes. A file name is any single path segment of 1 to 200 characters (UTF-16 units) on one line (no line or paragraph separator, U+2028 and U+2029), without `/`, `\`, control characters (U+0080 to U+009F included), text-direction override characters (U+202A to U+202E, U+2066 to U+2069) or a leading or trailing space, not only dots, and unique in the request. A refusal shows the name with each such character as `�`. A `"` in a file name round-trips: clients send it as `%22` and the server decodes it. So a literal `%22`, `%0A` or `%0D` in a file name is decoded too: `a%22b.png` is stored as `a"b.png`, and a name with `%0A` or `%0D` arrives with a line break and is refused as not a file name (`400`).
- **`alt.<filename>`:** optional, the alternative text of the picture of that name.
- At least one `text` or `file` part is needed. Only a `text` part is the same as a raw post. Only `file` parts store just the pictures. `X-Note-Tags` goes on the text note and on every picture. `X-Note-Title` goes on the text note; with only `file` parts it goes on every picture. `X-Feed-Password` and `X-Read-Id` work as for a raw post; `X-Note-Alt` and `X-Note-Name` with multipart are `400`.

**References.** The server swaps `![](name)` in the text for the picture's stored file name. It handles the image destination with a title (`![](name "title")`, the title is kept), a reference definition (`[l]: name`), a name in angle brackets (`<my chart.png>`) and a percent-encoded name (`my%20chart.png`); an exact match wins over a decoded one. Only the definition markdown uses for a label counts, which is the first: a repeated label's later definition is left alone, and its picture counts as not referred to. An image inside a code block or a code span is left as written, and a leading BOM is handled. A picture the text never refers to is added at the end as `![](file)`, so none is dropped.

**Caps.** The request body is at most the markdown limit (100 KB) plus 10 times `NOTEFEED_MAX_IMAGE_BYTES` plus 64 KiB, or it is `413`. The limits of the note and of each picture apply as usual, and the note and image caps are checked for the notes the feed has plus the new ones. The limit applies to the stored text: a text of exactly 100 KB cannot be posted with pictures, because the swapped file names make it longer.

**All or nothing.** Everything is checked first; then the pictures are stored, then the text. If anything fails, the notes this request stored are removed. The one thing that stays is a feed this request created (even a protected one) when a write fails after its creation: it is then an empty feed. A refusal names the part, for example `attachment "b.png": ...`. The whole request takes one slot of the [rate limit](configuration.md#rate-limits-and-caps).

**The answer** is `201` with what a raw post of the text answers (the first picture's, when there is no `text` part), plus `attachments`: the same fields for every picture, in order:

```json
{
  "id": "20260929T140512Z-3f2b8c1e-7d4a-4e6b-9a15-c0d2e8f41b73",
  "url": "https://notes.example.com/homelab-7f3k2q9x4m8wz/20260929T140512Z-3f2b8c1e-7d4a-4e6b-9a15-c0d2e8f41b73",
  "file": "20260929T140512Z-3f2b8c1e-7d4a-4e6b-9a15-c0d2e8f41b73.md",
  "attachments": [{ "id": "…", "file": "….png", "file_url": "…" }]
}
```

(the other fields of a [post](#posting-notes) are left out here). Raw requests are answered as before, without `attachments`. A client of this version needs a server of this version: an older server answers `415` to multipart.

**Errors** are those of posting, with the part named in the message. `400`: a file name that is not allowed or is given twice, a `file` part without a file name, more than 10 files, a part that is none of `text`, `file` and `alt.<filename>` (or a second `text`), an `alt.` for a file that is not there, a text that is not UTF-8, a blank text with no pictures, a body that is not valid multipart, nothing to post, and no `text` on a `PUT`. `415`: a file that is not an accepted picture or whose bytes are not that format. `413`: a picture, the text or the whole request is too large. `507`: a cap is reached.

## Feed settings and deleting a feed

A feed can have a **title** (at most 100 characters) and a **description** (at most 500), both on one line. The title is shown as a heading on the feed page, where the feed's name stays in the page header, and both show in the read-only view and in the RSS feed (see [Read links and RSS](feed.md#title-and-description)). The feed's name stays as it is: you can't rename a feed. A feed has neither until you set them.

`GET /api/v1/feeds/<feed>` answers with the feed's `name`, `title`, `description`, `show_sender`, `image_url`, `protected` and `read_url`. `read_url` is `null` while the feed has no notes, and for [a feed without a read link](operations.md#a-feed-without-a-read-link), and `image_url` is `null` while the feed has no title image (or its file was removed by hand), while the feed has no notes, and for a feed without a read link. `PUT` on the same URL replaces the title and the description, both at once, and answers with the feed; an empty string clears one. Surrounding spaces are trimmed, and control characters, including a line break, and text-direction override characters (U+202A to U+202E, U+2066 to U+2069) are refused.

```sh
curl -X PUT -H "Content-Type: application/json" \
  -d '{"title": "Homelab", "description": "Deploys and alerts"}' \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz
```

`show_sender` (a boolean, on by default) matters only when [sign-in](identity.md) is on: set to `false` in the `PUT` body, it leaves the sender out of the public read view, the RSS feed and the public read API. Leaving it out keeps the current value.

The feed's **title image** is one of the feed's [pictures](#pictures). Add `"image": "<file>"` to the body, with the `file` of a picture, to show it in the page header, the read-only view and as the RSS channel image. `"image": ""` removes it, and leaving `image` out keeps the one the feed has. A name that is not an image note of this feed is a `400`, and deleting that note takes the title image away. The title image is public, like the title.

`DELETE` removes the feed for good and answers `204` with no body: every note, every image, the title and description, the password and the read link. There is no undo and no trash:

```sh
curl -X DELETE https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz
```

What to know:

- **Who may:** whoever may post to the feed. On an open feed the name is the key, so anyone who knows it can change its title and delete the whole feed, not only add notes. A feed with [its own password](#a-feed-with-its-own-password) needs `X-Feed-Password` for all three, and an instance with a password needs `Authorization: Bearer` first, as for posting. The [read link](feed.md) can neither change settings nor delete.
- **The feed must exist.** A feed is created by its first note, and can only get a password then. `GET`, `PUT` and `DELETE` on a feed that doesn't exist answer `404` (`not_found`) and create nothing.
- **The name is free again,** at once. A feed created under it later is a new feed with a new read link; the old read link stays empty for good, and the old feed's password and settings are gone. A post that was already on its way when the feed was deleted creates such a new feed.
- **Settings are public to readers.** Anyone with the read link sees the title and description, through `GET /api/v1/read/<read id>` too, which needs no password. Anyone who has the feed's name and its password reads them with `GET /api/v1/feeds/<feed>`.
- **Limits:** `PUT` and `DELETE` count toward the same per-client [rate limit](configuration.md#rate-limits-and-caps) as posts. The `PUT` body is limited to 8 KB. A refused `PUT` leaves the settings as they were.
- **Errors:** `400` for an invalid or reserved name, or a body that isn't JSON with string `title` and `description` (and `image`, if present), or a title or description that is too long or has control or text-direction override characters, or a malformed or reserved feed's `read_id`; `401` when a password is missing or wrong (before it says anything about the feed); `404` when the feed doesn't exist; `409` (`taken`) when the `read_id` belongs to another feed; `429` over the limit.

In the browser the same two things are in the feed page's [Feed settings and Delete feed sections](web-ui.md#feed-settings-and-deleting-a-feed).

## Choosing a feed's read id

A feed's name never changes, but its [read id](feed.md) (the part of the read link and the RSS link after `/r/`) can be chosen and changed. It is 22 random characters unless you say otherwise.

- **At creation:** send `X-Read-Id` with the post that creates the feed (or the `read_id` argument of the MCP `post_note` tool): `-H "X-Read-Id: my-blog"`. Left out or empty, it is random. For a feed that already exists it is ignored.
- **Later:** `read_id` in the `PUT /api/v1/feeds/<feed>` body (`{"title": "", "description": "", "read_id": "my-blog"}`), in the **Read id** field on the settings page, in `update_feed`, and in the client packages (`readId` on `post()`, `read_id` in `updateFeed()` settings; `read_id` in Python). An empty value gives a new random one; leaving it out keeps the current one.
- **Rule:** 3 to 64 characters of `a-z`, `0-9`, `-` and `_`. A read id that belongs to another feed, or that is held back for a [reserved feed](configuration.md#reserved-feeds), is refused with `409` (`taken`); a malformed one with `400`. A reserved feed keeps its read id (its name). An operator can turn chosen read ids off with `NOTEFEED_ALLOW_CUSTOM_IDS=0` ([configuration](configuration.md)), which leaves only random ones.

What to know:

- **A short, readable read id can be guessed**, and anyone who guesses it can read the feed. Protect the feed with [a password](#a-feed-with-its-own-password) if that matters.
- **The old read id is freed.** Nothing is recorded: the old link answers like any unknown read id (an empty feed) until another feed takes that id, so it may later show somebody else's notes. Tell the people who have the old link.
- **Notes are not edited.** Images in a note that are written relative to the feed (`![](<id>.png)`, as a [picture](#pictures) post answers) follow the new read id, and so does the title image. A full URL in a note (`![](https://…/r/<old id>/<file>)`) keeps the old read id and stops working: changing those is up to you.
- **Limits:** a change counts toward the same per-client [rate limit](configuration.md#rate-limits-and-caps) as posts.

## Feed names

A feed name is 1 to 64 characters of `a`–`z`, `0`–`9`, `-` and `_`. Anything else is rejected with `400`. These names are taken by notefeed itself and are reserved: `r`, `api`, `login`, `logout`, `mcp`, `n`, `_next`, `static`, `health`, plus any names in `NOTEFEED_RESERVED_FEEDS` (see [Configuration](configuration.md)). Posting to a reserved name answers `400`, except `logout`: that's the web UI's log-out route, which answers with a redirect and stores nothing. A trailing slash is fine: `POST /<feed>/` works like `POST /<feed>`.

!!! warning "The name is the key"
    Anyone who knows a feed's name can read it, post to it, edit and delete its notes, and delete the feed. Pick one that's hard to guess, like `homelab-7f3k2q9x4m8wz`, and share the read link instead of the name.

## With a password

If the instance has a password (`NOTEFEED_PASSWORD`), send it as a bearer token:

```sh
curl -H "Authorization: Bearer $NOTEFEED_PASSWORD" -H "Content-Type: text/markdown" \
  --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz
```

Without a password set, the header isn't needed and is ignored.

## A feed with its own password

A feed can have a password of its own, so that strangers who guess or learn its name can't read or post. It is set only when the feed is created: send it as `X-Feed-Password` with the feed's first note.

```sh
curl -H "X-Feed-Password: ${FEED_PASSWORD:?}" -H "Content-Type: text/markdown" \
  --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz
```

!!! warning "An empty password creates an open feed"
    An empty `X-Feed-Password` is the same as none, and curl leaves out a header whose value is empty. So with `$FEED_PASSWORD` unset, a plain `"X-Feed-Password: $FEED_PASSWORD"` on the first post creates an open feed without any error, and an open feed can never get a password afterwards. `${FEED_PASSWORD:?}` makes the shell stop with an error instead of sending the request.

The password is 1 to 256 printable ASCII characters: unaccented letters, digits, symbols and spaces, with no space at the start or end. That way the same password arrives unchanged in a header and in the password forms. Anything else (`ä`, an emoji, a tab) is refused with `400`. An empty `X-Feed-Password` is the same as none. A password sent to a feed that already exists and has none is refused with `409` and `feed_exists`: an open feed can't be claimed afterwards. The first post to a name that doesn't exist yet creates a protected feed only if the note itself is valid.

After that, posting to the feed, reading its notes (`GET /api/v1/feeds/<feed>/notes`, and one note by id) and opening `/<feed>` in a browser all need the password. Scripts send it on every request:

```sh
curl -H "X-Feed-Password: ${FEED_PASSWORD:?}" -H "Content-Type: text/markdown" \
  --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz

curl -H "X-Feed-Password: ${FEED_PASSWORD:?}" \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/notes
```

On an instance with a password, send both: `Authorization: Bearer $NOTEFEED_PASSWORD` for the instance and `X-Feed-Password` for the feed. The [read link](feed.md) stays open, so feed readers need no change. A password in the body only creates a feed; it never unlocks one, so use the header to post to a protected feed.

To change the password, `PUT /api/v1/feeds/<feed>/password` with the current password in `X-Feed-Password` and the new one in a JSON body. To remove it, `DELETE` the same URL. The feed stays, open to anyone who knows its name. Both answer `204`, and both answer `409` on a feed that has no password: they can't add one.

```sh
curl -X PUT -H "X-Feed-Password: ${FEED_PASSWORD:?}" -H "Content-Type: application/json" \
  -d '{"password": "a-new-password"}' \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/password

curl -X DELETE -H "X-Feed-Password: ${FEED_PASSWORD:?}" \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/password
```

Changing the password signs every browser out of the feed. A wrong or missing feed password is `401`; note that this tells a stranger that a protected feed of that name exists, though not what is in it or its read id. Wrong passwords count toward the same per-client limit as the instance password; a request with no feed password at all is refused but not counted. If the password is lost, see [Operations](operations.md#a-lost-feed-password).

## Types

`Content-Type` is required and must be one of these (or `multipart/form-data`, see [Posting a note with its pictures](#posting-a-note-with-its-pictures)). Nothing is guessed:

| Content type | A note of |
|---|---|
| `text/markdown` (optionally `; charset=utf-8`) | markdown, UTF-8 text, at most 100 KB |
| `image/png`, `image/jpeg`, `image/gif`, `image/webp` | a picture of that format, at most `NOTEFEED_MAX_IMAGE_BYTES` |

Any other type, including `text/plain`, `application/x-www-form-urlencoded` (what curl sends by default), `application/json`, `application/octet-stream` and no type at all, is rejected with `415`, and the message lists the types to send. So is a body that is not what it declares: a picture without its format's signature, or markdown that is not valid UTF-8. A blank markdown note is `400`.

From Python or Node, use the [client libraries](clients.md) instead of building requests yourself; they set the type for you.

## Titles and filenames

- **Title:** the first `# ` heading. Without one, it's the first non-empty line, with list and quote markers removed. `#` lines inside fenced code blocks are ignored. Titles are cut to 100 characters.
- **File:** `<DATA_DIR>/<feed>/<id>.md` (or `.png`, `.jpg`, `.gif`, `.webp`), exactly the body as posted, with the note's metadata in `.<id>.<extension>.json` next to it. The id is the UTC time to the second plus a random UUID, e.g. `20261002T091400Z-3f2b8c1e-7d4a-4e6b-9a15-c0d2e8f41b73`, so neither the id nor the file name nor the note's URLs carry its title. Notes created before that keep their slugged ids.
- **Collisions:** two notes with the same title in the same second get `-2`, `-3` and so on. An existing note is never overwritten.

## Errors

| Status | When |
|---|---|
| `400` | The feed name is invalid or reserved; the note is empty; a title, alt text or tag is invalid; the password for a new feed is not valid (see [A feed with its own password](#a-feed-with-its-own-password)); a `read_id` that is not 3 to 64 characters of `a-z`, `0-9`, `-`, `_`, or when chosen read ids are turned off |
| `401` | The instance has a password and the `Authorization` header is missing or wrong, or the feed has its own password and `X-Feed-Password` is missing or wrong |
| `409` | A password was sent for a feed that already exists without one (`feed_exists`); the `read_id` for a new feed belongs to another feed (`taken`) |
| `404` | No feed in the URL: `POST /`, for example from an empty variable in `$NOTEFEED_URL/$FEED`. For [editing and deleting](#editing-and-deleting-notes): no such note |
| `413` | The body is larger than 100 KB (102400 bytes); for a [picture](#pictures), larger than `NOTEFEED_MAX_IMAGE_BYTES`; for a [multipart request](#posting-a-note-with-its-pictures), larger than its cap |
| `415` | The `Content-Type` is missing or not one of the [types](#types), or the body is not what it declares (a picture that is not that format, markdown that is not UTF-8) |
| `429` | Too many posts, edits or deletes, or too many wrong passwords, from this client in the last minute. `Retry-After` says how many seconds to wait. See [Rate limits and caps](configuration.md#rate-limits-and-caps). |
| `500` | The note could not be written. No partial file is left behind. |
| `507` | A cap is reached: a new feed when there are already `NOTEFEED_MAX_FEEDS` feeds, or a note to a feed that already has `NOTEFEED_MAX_NOTES_PER_FEED` notes, or an image to a feed that already has `NOTEFEED_MAX_IMAGES_PER_FEED` images |

Error responses are JSON: `{"error": "<short reason>", "code": "<code>"}`. The reason is for people; match on the status or the `code` (`invalid_feed`, `reserved_feed`, `auth`, `rate_limited`, `too_many_attempts`, `feed_limit`, `note_limit`, `image_limit`, `empty_note`, `too_large`, `unsupported_type`, `invalid_body`, `feed_exists`, `taken`).

## From a script

The [client libraries](clients.md) handle the request, the password and the errors for you, and bring a `notefeed` command for shell scripts. Plain curl works everywhere else.

A backup job that reports how it went:

=== "notefeed command"

    ```sh
    #!/usr/bin/env bash
    set -euo pipefail
    # NOTEFEED_URL and NOTEFEED_FEED (and NOTEFEED_PASSWORD, if set) come from the environment.

    if output=$(restic backup /srv 2>&1); then status="finished"; else status="FAILED"; fi

    printf '# Backup %s on %s\n\n```\n%s\n```\n' "$status" "$(hostname)" "$(tail -n 5 <<<"$output")" |
      notefeed post - > /dev/null
    ```

=== "curl"

    ```sh
    #!/usr/bin/env bash
    set -euo pipefail

    if output=$(restic backup /srv 2>&1); then status="finished"; else status="FAILED"; fi

    printf '# Backup %s on %s\n\n```\n%s\n```\n' "$status" "$(hostname)" "$(tail -n 5 <<<"$output")" |
      curl -fsS -H "Content-Type: text/markdown" --data-binary @- https://notes.example.com/homelab-7f3k2q9x4m8wz > /dev/null
    ```

From a program, with the client libraries:

=== "Python"

    ```python
    import shutil
    from notefeed import Client

    client = Client("https://notes.example.com", feed="homelab-7f3k2q9x4m8wz")

    usage = shutil.disk_usage("/srv")
    used = usage.used / usage.total
    if used > 0.9:
        print(client.post(f"# Disk space low\n/srv is {used:.0%} full").url)
    ```

=== "Node"

    ```js
    import { statfs } from "node:fs/promises";
    import { Client } from "notefeed";

    const client = new Client({ url: "https://notes.example.com", feed: "homelab-7f3k2q9x4m8wz" });

    const fs = await statfs("/srv");
    const used = 1 - fs.bavail / fs.blocks;
    if (used > 0.9) console.log((await client.post(`# Disk space low\n/srv is ${Math.round(used * 100)}% full`)).url);
    ```
