# Pictures

A picture is a note of its own: post it with its own `Content-Type` (or with a note, in [one multipart request](#posting-a-note-with-its-pictures)), and it is stored next to the markdown notes, listed in the feed, shown in the read-only view and sent to RSS readers as an enclosure. A markdown note can show it too, by writing `![](<file>)` with the `file` that the post returned.

```sh
curl -H "Content-Type: image/png" --data-binary @photo.png https://notes.example.com/homelab-7f3k2q9x4m8wz
```

The answer is the same as for any note, with the picture's `file` and `file_url` (see [Posting notes](posting.md)). `X-Note-Alt` sets its alternative text (one line, at most 500 characters, with no control or text-direction override characters, like a [title](titles-and-tags.md#titles)), `X-Note-Name` keeps the original file name (without `/`, `\`, control characters, line separators and text-direction override characters, trimmed, at most 200 characters), and `X-Note-Title` and `X-Note-Tags` work as for markdown. Non-ASCII text in these headers is sent as its UTF-8 bytes, which curl and the client packages do.

What to know:

- **Types:** `image/png`, `image/jpeg`, `image/gif` and `image/webp`. notefeed does not trust the declaration: the body must carry the signature of the declared format, so a JPEG sent as `image/png` is `415`. SVG is not accepted, because it can carry script.
- **Size:** at most 5 MiB (5242880 bytes) by default, set with `NOTEFEED_MAX_IMAGE_BYTES`. An optional cap on the number of pictures per feed is `NOTEFEED_MAX_IMAGES_PER_FEED`, off by default; pictures do not count toward `NOTEFEED_MAX_NOTES_PER_FEED`. See [Rate limits and caps](../self-hosting/limits.md).
- **Stored as sent.** The picture is kept byte for byte: no resizing, no re-encoding, and no metadata removed. A photo's EXIF data, which can include where it was taken, stays in the file, and the file is public (see below). Remove it before you post if that matters.
- **Who may post:** whoever may post to the feed, in the same order as for a note: the instance password, then the [feed's password](feed-passwords.md#in-the-api). Posts count toward the same per-client [rate limit](../self-hosting/limits.md#rate-limits-and-caps). The first picture can create the feed, with a password, like a first note.
- **`![](file)` follows the read id.** In a markdown note, `![](file)` shows the picture from the feed's current read link, so it keeps working if the read id changes. A full URL (`![](https://…)`) is shown as written and is yours to update.
- **Pictures are as public as the read link.** A picture is served under the feed's read id, `/r/<read id>/<file>`, with no password, even on a locked instance or a protected feed, so that it shows in the read-only view and in feed readers, which have no password to send. Anyone who has the read link, or the file's URL, can fetch it, and the feed's name never appears in the URL. Don't post anything you would not give to everyone who has the read link.
- **Deleting and editing.** A picture is deleted like any note (`DELETE` on its URL), which removes the file. Replace its bytes with `PUT` (another image of the same type) and change its title or alt text with `PATCH`.
- **Errors:** those of posting. `415` (`unsupported_type`) is also the answer to an empty body or to bytes that are not that format; `507` (`image_limit`) means the feed already has `NOTEFEED_MAX_IMAGES_PER_FEED` pictures; `403` (`images_off`) means the instance takes no pictures at all (`NOTEFEED_IMAGE_UPLOADS=0`, see [Rate limits and caps](../self-hosting/limits.md#no-pictures-at-all)): no picture, no replaced picture and no note with pictures is stored, while the pictures it already has keep being served.

In the browser, the compose box and the note editor take pictures with the [Add image](web-ui.md#adding-an-image) button, by paste or by drop.

## Posting a note with its pictures

A note with its pictures is one `multipart/form-data` request, to `POST /<feed>` (or `/api/v1/feeds/<feed>/notes`). The [clients](../integrations/clients.md#from-code), the `notefeed post --attach` command, the [web UI](web-ui.md#adding-an-image) and the [MCP](../integrations/mcp.md) `post_note` tool all send it. It is the one exception to one raw file per request:

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

**All or nothing.** Everything is checked first; then the pictures are stored, then the text. If anything fails, the notes this request stored are removed. The one thing that stays is a feed this request created (even a protected one) when a write fails after its creation: it is then an empty feed. A refusal names the part, for example `attachment "b.png": ...`. The whole request takes one slot of the [rate limit](../self-hosting/limits.md#rate-limits-and-caps).

**The answer** is `201` with what a raw post of the text answers (the first picture's, when there is no `text` part), plus `attachments`: the same fields for every picture, in order:

```json
{
  "id": "20260929T140512Z-3f2b8c1e-7d4a-4e6b-9a15-c0d2e8f41b73",
  "url": "https://notes.example.com/homelab-7f3k2q9x4m8wz/20260929T140512Z-3f2b8c1e-7d4a-4e6b-9a15-c0d2e8f41b73",
  "file": "20260929T140512Z-3f2b8c1e-7d4a-4e6b-9a15-c0d2e8f41b73.md",
  "attachments": [{ "id": "…", "file": "….png", "file_url": "…" }]
}
```

(the other fields of a [post](posting.md#posting-notes) are left out here). Raw requests are answered as before, without `attachments`. A client of this version needs a server of this version: an older server answers `415` to multipart.

**Errors** are those of posting, with the part named in the message. `400`: a file name that is not allowed or is given twice, a `file` part without a file name, more than 10 files, a part that is none of `text`, `file` and `alt.<filename>` (or a second `text`), an `alt.` for a file that is not there, a text that is not UTF-8, a blank text with no pictures, a text sent with pictures that takes longer than `NOTEFEED_PARSE_TIMEOUT_MS` (10 s) to read (it is read in a worker thread, so only its sender waits), a body that is not valid multipart, nothing to post, and no `text` on a `PUT`. `415`: a file that is not an accepted picture or whose bytes are not that format. `413`: a picture, the text or the whole request is too large. `507`: a cap is reached. `403`: the instance takes no pictures (`images_off`).
