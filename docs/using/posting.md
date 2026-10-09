# Posting notes

A note is a file. Post its bytes to `POST /<feed>`, and say in `Content-Type` what kind of file it is:

```sh
curl -H "Content-Type: text/markdown" --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz
```

`POST /<feed>` is the short form of `POST /api/v1/feeds/<feed>/notes`; both behave the same. To read notes back as JSON, see the [REST API](../integrations/api.md). The kinds of file a note can be are in [Types](#types): markdown, and the picture formats PNG, JPEG, GIF and WebP (see [Pictures](pictures.md#pictures)).

A note posted with the password has no sender. Only a person signed in through [sign-in](../self-hosting/sign-in/index.md), which is opt-in, posts with one.

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
- `read_url`: the feed's read-only RSS link, for feed readers and for sharing. See [Read links](read-links.md). It is `null` only for [a feed without a read link](../self-hosting/deleting.md#a-feed-without-a-read-link).
- `file`: the note's file name, `<id>.<extension>`; `file_url`: where that file is served, under the read id (`null` in the same case as `read_url`).

!!! tip "Use `--data-binary`, not `-d`"
    `curl -d` strips newlines from files. `--data-binary` sends the file unchanged. Either way, set the `Content-Type`: without it curl sends `application/x-www-form-urlencoded`, which notefeed refuses with `415` and a message naming the types to send.

## Types

`Content-Type` is required and must be one of these (or `multipart/form-data`, see [Posting a note with its pictures](pictures.md#posting-a-note-with-its-pictures)). Nothing is guessed:

| Content type | A note of |
|---|---|
| `text/markdown` (optionally `; charset=utf-8`) | markdown, UTF-8 text, at most 100 KB |
| `image/png`, `image/jpeg`, `image/gif`, `image/webp` | a picture of that format, at most `NOTEFEED_MAX_IMAGE_BYTES` |

Any other type, including `text/plain`, `application/x-www-form-urlencoded` (what curl sends by default), `application/json`, `application/octet-stream` and no type at all, is rejected with `415`, and the message lists the types to send. So is a body that is not what it declares: a picture without its format's signature, or markdown that is not valid UTF-8. A blank markdown note is `400`.

From Python or Node, use the [client libraries](../integrations/clients.md) instead of building requests yourself; they set the type for you.

## With an instance password

If the instance has a password (`NOTEFEED_PASSWORD`), send it as a bearer token:

```sh
curl -H "Authorization: Bearer $NOTEFEED_PASSWORD" -H "Content-Type: text/markdown" \
  --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz
```

Without a password set, the header isn't needed and is ignored.

## Errors

| Status | When |
|---|---|
| `400` | The feed name is invalid or reserved; the note is empty; a title, alt text or tag is invalid; the password for a new feed is not valid (see [A feed with its own password](feed-passwords.md#in-the-api)); a `read_id` that is not 3 to 64 characters of `a-z`, `0-9`, `-`, `_`, or when chosen read ids are turned off |
| `401` | The instance has a password and the `Authorization` header is missing or wrong, or the feed has its own password and `X-Feed-Password` is missing or wrong |
| `409` | A password was sent for a feed that already exists without one (`feed_exists`); the `read_id` for a new feed belongs to another feed (`taken`) |
| `404` | No feed in the URL: `POST /`, for example from an empty variable in `$NOTEFEED_URL/$FEED`. For [editing and deleting](editing.md#editing-and-deleting-notes): no such note |
| `413` | The body is larger than 100 KB (102400 bytes); for a [picture](pictures.md#pictures), larger than `NOTEFEED_MAX_IMAGE_BYTES`; for a [multipart request](pictures.md#posting-a-note-with-its-pictures), larger than its cap |
| `415` | The `Content-Type` is missing or not one of the [types](#types), or the body is not what it declares (a picture that is not that format, markdown that is not UTF-8) |
| `429` | Too many posts, edits or deletes, or too many wrong passwords, from this client in the last minute. `Retry-After` says how many seconds to wait. See [Rate limits and caps](../self-hosting/limits.md#rate-limits-and-caps). |
| `500` | The note could not be written. No partial file is left behind. |
| `507` | A cap is reached: a new feed when there are already `NOTEFEED_MAX_FEEDS` feeds, or a note to a feed that already has `NOTEFEED_MAX_NOTES_PER_FEED` notes, or an image to a feed that already has `NOTEFEED_MAX_IMAGES_PER_FEED` images |

Error responses are JSON: `{"error": "<short reason>", "code": "<code>"}`. The reason is for people; match on the status or the `code` (`invalid_feed`, `reserved_feed`, `auth`, `rate_limited`, `too_many_attempts`, `feed_limit`, `note_limit`, `image_limit`, `empty_note`, `too_large`, `unsupported_type`, `invalid_body`, `feed_exists`, `taken`, `removed`, `blocked`). `410` (`removed`) is a feed the operator removed for good, `451` (`blocked`) an image the operator removed that may not be posted again, in any feed.
