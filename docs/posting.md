# Posting notes

Send the note's markdown to `POST /<feed>`:

```sh
curl --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz
```

`POST /<feed>` is the short form of `POST /api/v1/feeds/<feed>/notes`; both behave the same. To read notes back as JSON, see the [REST API](api.md).

The feed is created by its first note; there's nothing to set up first. notefeed stores the body exactly as sent, byte for byte, and answers `201 Created`:

```json
{
  "id": "20260929T140512Z-backup-finished",
  "url": "https://notes.example.com/homelab-7f3k2q9x4m8wz/20260929T140512Z-backup-finished",
  "feed_url": "https://notes.example.com/homelab-7f3k2q9x4m8wz",
  "read_url": "https://notes.example.com/r/q2Zc9kD0bTnVx4LmAe7sWp/feed.xml"
}
```

- `url`: the note's page in the web UI.
- `feed_url`: the feed's page in the web UI.
- `read_url`: the feed's read-only RSS link, for feed readers and for sharing. See [Read links and RSS](feed.md). It is `null` only for [a feed without a read link](operations.md#a-feed-without-a-read-link).

!!! tip "Use `--data-binary`, not `-d`"
    `curl -d` strips newlines from files. `--data-binary` sends the file unchanged.

## Editing and deleting notes

A note can be changed or removed after it was posted. Both use the note's URL in the API, `/api/v1/feeds/<feed>/notes/<id>`, where `<id>` is the `id` that posting returned.

`PUT` replaces the note's markdown with the body, which is read as for posting (same formats and the same 100 KB limit), and answers `200` with the note as it is now:

```sh
curl -X PUT --data-binary @note.md \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/notes/20260929T140512Z-backup-finished
```

`DELETE` removes the note for good and answers `204` with no body. There is no undo and no trash:

```sh
curl -X DELETE \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/notes/20260929T140512Z-backup-finished
```

What to know:

- **Who may:** whoever may post to the feed. On an open feed the name is the key, so anyone who knows it can edit and delete its notes, not only add to them. A feed with [its own password](#a-feed-with-its-own-password) needs `X-Feed-Password` for both, and an instance with a password needs `Authorization: Bearer` first, as for posting. The [read link](feed.md) can neither edit nor delete.
- **The id stays.** An edit keeps the note's id, so its URLs, its place in the feed and its RSS `guid` stay the same. The title is taken from the new markdown, so the title can end up different from the slug in the id. Notes have no edit time and no history: the old text is gone, and the note keeps its original time.
- **A feed reader may not show the change.** Because the `guid` stays, a reader that has already seen the item may keep showing the old text.
- **The feed stays,** even when you delete its last note. Its name and its password remain, and the feed is then empty.
- **Limits:** edits and deletes count toward the same per-client [rate limit](configuration.md#rate-limits-and-caps) as posts. An edit must pass the same checks as a post: not empty, UTF-8, at most 100 KB. A refused edit leaves the note unchanged. A `password` field in the body of an edit is ignored.
- **Errors:** `404` (`not_found`) means no note has that id in that feed. That includes a feed that does not exist and an id that could not belong to a note. A protected feed answers `401` before it says anything about its notes. The other statuses are those of posting: `400`, `401`, `413`, `415` and `429`. Neither request creates a feed.

## Images

A note can show images. They are not part of the note's file: you upload an image to the feed, get a URL back, and put that URL in the note as ordinary markdown, `![](url)`. The note stays a plain markdown file.

`POST /api/v1/feeds/<feed>/images` takes the image itself as the body:

```sh
curl --data-binary @photo.png -H "Content-Type: image/png" \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/images
```

It answers `201 Created`:

```json
{
  "file": "3b1f0c9d5a7e42c8b6d1e0f4a9c27d58.png",
  "url": "https://notes.example.com/r/q2Zc9kD0bTnVx4LmAe7sWp/images/3b1f0c9d5a7e42c8b6d1e0f4a9c27d58.png",
  "markdown": "![](https://notes.example.com/r/q2Zc9kD0bTnVx4LmAe7sWp/images/3b1f0c9d5a7e42c8b6d1e0f4a9c27d58.png)"
}
```

- `file`: the stored file's name. It is what a feed's [title image](#feed-settings-and-deleting-a-feed) is set with.
- `url`: where the image is served. It is absolute, built from `PUBLIC_URL` like the other links.
- `markdown`: `![](url)`, ready to put in a note.

Post a note that contains it and the image shows in the feed page, the read-only view and RSS readers that render images.

What to know:

- **Formats:** PNG, JPEG, GIF and WebP. notefeed looks at the first bytes of the file, not at the `Content-Type` you send, so `Content-Type` can be anything (`application/octet-stream` is fine) and a file that is not one of those four formats is refused even if it says `image/png`. SVG is not accepted, because it can carry script.
- **Size:** at most 5 MiB (5242880 bytes) by default, set with `NOTEFEED_MAX_IMAGE_BYTES`. An optional cap on the number of images per feed is `NOTEFEED_MAX_IMAGES_PER_FEED`, off by default. See [Configuration](configuration.md#rate-limits-and-caps).
- **Stored as sent.** The image is kept byte for byte: no resizing, no re-encoding, and no metadata removed. A photo's EXIF data, which can include where it was taken, stays in the file, and the file is public (see below). Remove it before you upload if that matters.
- **Same bytes, same URL.** The file is named after a hash of its contents, so uploading the same image twice gives the same URL and stores one file. A URL's content never changes, so browsers may keep it for a year.
- **Who may upload:** whoever may post to the feed: the instance password, then the [feed's password](#a-feed-with-its-own-password), in the same order as for a note. Uploads count toward the same per-client [rate limit](configuration.md#rate-limits-and-caps) as posts.
- **The feed must exist.** A feed is created by its first note, so upload after the first note. Uploading to a feed that does not exist answers `404` and creates nothing, and so does uploading to [a feed without a read link](operations.md#a-feed-without-a-read-link): an image's URL is built from the read id, so nothing is stored.
- **Images are as public as the read link.** An image is served under the feed's read id, `/r/<read id>/images/<file>`, with no password, even on a locked instance or a protected feed, so that it shows in the read-only view and in feed readers, which have no password to send. Anyone who has the read link, or an image's URL, can fetch it, and the feed's name never appears in the URL. Don't upload anything you would not give to everyone who has the read link.
- **No list or delete yet.** There is no endpoint to list or delete images. They stay until the feed is [deleted](#feed-settings-and-deleting-a-feed), and deleting a note does not delete the images it used. To remove one by hand, see [Operations](operations.md#images).
- **Errors:** `400` for an invalid or reserved feed name; `401` when a password is missing or wrong; `404` when the feed does not exist; `413` (`too_large`) when the image is over the size limit; `415` (`unsupported_type`) when it is not a PNG, JPEG, GIF or WebP image, which includes an empty body; `429` over the rate limit; `507` (`image_limit`) when the feed already has `NOTEFEED_MAX_IMAGES_PER_FEED` images. Uploading an image the feed already has is never refused for the cap.

In the browser, the compose box and the note editor have an [Add image](web-ui.md#adding-an-image) button.

## Feed settings and deleting a feed

A feed can have a **title** (at most 100 characters) and a **description** (at most 500), both on one line. The title is shown as a heading on the feed page, where the feed's name stays in the page header, and both show in the read-only view and in the RSS feed (see [Read links and RSS](feed.md#title-and-description)). The feed's name stays as it is: you can't rename a feed. A feed has neither until you set them.

`GET /api/v1/feeds/<feed>` answers with the feed's `name`, `title`, `description`, `image_url`, `protected` and `read_url`. `read_url` is `null` while the feed has no notes, and for [a feed without a read link](operations.md#a-feed-without-a-read-link), and `image_url` is `null` while the feed has no title image, and for a feed without a read link. `PUT` on the same URL replaces the title and the description, both at once, and answers with the feed; an empty string clears one. Surrounding spaces are trimmed, and control characters, including a line break, are refused.

```sh
curl -X PUT -H "Content-Type: application/json" \
  -d '{"title": "Homelab", "description": "Deploys and alerts"}' \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz
```

The feed's **title image** is an image [uploaded to this feed](#images). Add `"image": "<file>"` to the body, with the `file` the upload returned, to show it in the page header, the read-only view and as the RSS channel image. `"image": ""` removes it, and leaving `image` out keeps the one the feed has. A name that is not an existing image of this feed is a `400`. The title image is public, like the title.

`DELETE` removes the feed for good and answers `204` with no body: every note, every uploaded image, the title and description, the password and the read link. There is no undo and no trash:

```sh
curl -X DELETE https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz
```

What to know:

- **Who may:** whoever may post to the feed. On an open feed the name is the key, so anyone who knows it can change its title and delete the whole feed, not only add notes. A feed with [its own password](#a-feed-with-its-own-password) needs `X-Feed-Password` for all three, and an instance with a password needs `Authorization: Bearer` first, as for posting. The [read link](feed.md) can neither change settings nor delete.
- **The feed must exist.** A feed is created by its first note, and can only get a password then. `GET`, `PUT` and `DELETE` on a feed that doesn't exist answer `404` (`not_found`) and create nothing.
- **The name is free again,** at once. A feed created under it later is a new feed with a new read link; the old read link stays empty for good, and the old feed's password and settings are gone. A post that was already on its way when the feed was deleted creates such a new feed.
- **Settings are public to readers.** Anyone with the read link sees the title and description, through `GET /api/v1/read/<read id>` too, which needs no password. Anyone who has the feed's name and its password reads them with `GET /api/v1/feeds/<feed>`.
- **Limits:** `PUT` and `DELETE` count toward the same per-client [rate limit](configuration.md#rate-limits-and-caps) as posts. The `PUT` body is limited to 8 KB. A refused `PUT` leaves the settings as they were.
- **Errors:** `400` for an invalid or reserved name, or a body that isn't JSON with string `title` and `description` (and `image`, if present), or a title or description that is too long or has control characters; `401` when a password is missing or wrong (before it says anything about the feed); `404` when the feed doesn't exist; `429` over the limit.

In the browser the same two things are in the feed page's [Feed settings and Delete feed sections](web-ui.md#feed-settings-and-deleting-a-feed).

## Feed names

A feed name is 1 to 64 characters of `a`–`z`, `0`–`9`, `-` and `_`. Anything else is rejected with `400`. These names are taken by notefeed itself and are reserved: `r`, `api`, `login`, `logout`, `mcp`, `n`, `_next`, `static`, `health`. Posting to a reserved name answers `400`, except `logout`: that's the web UI's log-out route, which answers with a redirect and stores nothing. A trailing slash is fine: `POST /<feed>/` works like `POST /<feed>`.

!!! warning "The name is the key"
    Anyone who knows a feed's name can read it, post to it, edit and delete its notes, and delete the feed. Pick one that's hard to guess, like `homelab-7f3k2q9x4m8wz`, and share the read link instead of the name.

## With a password

If the instance has a password (`NOTEFEED_PASSWORD`), send it as a bearer token:

```sh
curl -H "Authorization: Bearer $NOTEFEED_PASSWORD" \
  --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz
```

Without a password set, the header isn't needed and is ignored.

## A feed with its own password

A feed can have a password of its own, so that strangers who guess or learn its name can't read or post. It is set only when the feed is created: send it as `X-Feed-Password` with the feed's first note.

```sh
curl -H "X-Feed-Password: ${FEED_PASSWORD:?}" \
  --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz
```

!!! warning "An empty password creates an open feed"
    An empty `X-Feed-Password` is the same as none, and curl leaves out a header whose value is empty. So with `$FEED_PASSWORD` unset, a plain `"X-Feed-Password: $FEED_PASSWORD"` on the first post creates an open feed without any error, and an open feed can never get a password afterwards. `${FEED_PASSWORD:?}` makes the shell stop with an error instead of sending the request.

The password is 1 to 256 printable ASCII characters: unaccented letters, digits, symbols and spaces, with no space at the start or end. That way the same password arrives unchanged in a header, a form and JSON. Anything else (`ä`, an emoji, a tab) is refused with `400`. A JSON or form body can carry the password as a `password` field instead (`{"markdown": "# Hi", "password": "..."}`, or `curl -F markdown=@note.md -F password=...`); the header wins if both are sent, and an empty field is the same as none. A password sent to a feed that already exists and has none is refused with `409` and `feed_exists`: an open feed can't be claimed afterwards. The first post to a name that doesn't exist yet creates a protected feed only if the note itself is valid.

After that, posting to the feed, reading its notes (`GET /api/v1/feeds/<feed>/notes`, and one note by id) and opening `/<feed>` in a browser all need the password. Scripts send it on every request:

```sh
curl -H "X-Feed-Password: ${FEED_PASSWORD:?}" \
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

## Formats

| Content type | Treated as |
|---|---|
| none | raw markdown |
| `text/markdown`, `text/plain` | raw markdown |
| `application/x-www-form-urlencoded` | raw markdown (what `curl --data-binary` sends by default) |
| `application/json` | an object with a string field `markdown` |
| `multipart/form-data` | a form with a field `markdown` (`curl -F markdown=@note.md`; it's also what the web UI's compose box sends) |

Any other content type is rejected with `415`. The body must be UTF-8, and the 100 KB limit counts the whole body, a form's framing included.

From Python or Node, use the [client libraries](clients.md) instead of building requests yourself. From other languages, JSON is often easier than a raw body:

```sh
curl -H "Content-Type: application/json" \
  --data-binary @- https://notes.example.com/homelab-7f3k2q9x4m8wz <<'EOF'
{
  "markdown": "# Deploy done\nimmich v3.2.4 on host-2"
}
EOF
```

## Titles and filenames

- **Title:** the first `# ` heading. Without one, it's the first non-empty line, with list and quote markers removed. `#` lines inside fenced code blocks are ignored. Titles are cut to 100 characters.
- **File:** `<DATA_DIR>/<feed>/<id>.md`, where the id is the UTC time to the second plus a slug of the title, e.g. `20260929T140512Z-backup-finished`. Accented letters become plain ones (`Café` → `cafe`). A title with no usable letters becomes `note`.
- **Collisions:** two notes with the same title in the same second get `-2`, `-3` and so on. An existing note is never overwritten.

## Errors

| Status | When |
|---|---|
| `400` | The feed name is invalid or reserved; the note is empty; the JSON is invalid or has no string `markdown`; the body is not UTF-8; the password for a new feed is not valid (see [A feed with its own password](#a-feed-with-its-own-password)) |
| `401` | The instance has a password and the `Authorization` header is missing or wrong, or the feed has its own password and `X-Feed-Password` is missing or wrong |
| `409` | A password was sent for a feed that already exists without one (`feed_exists`) |
| `404` | No feed in the URL: `POST /`, for example from an empty variable in `$NOTEFEED_URL/$FEED`. For [editing and deleting](#editing-and-deleting-notes): no such note |
| `413` | The body is larger than 100 KB (102400 bytes); for an [image upload](#images), larger than `NOTEFEED_MAX_IMAGE_BYTES` |
| `415` | The content type is not one of those above; for an [image upload](#images), the bytes are not a PNG, JPEG, GIF or WebP image |
| `429` | Too many posts, edits or deletes, or too many wrong passwords, from this client in the last minute. `Retry-After` says how many seconds to wait. See [Rate limits and caps](configuration.md#rate-limits-and-caps). |
| `303` | The request asked for HTML (`Accept: text/html`, as a browser submitting a form does): back to the feed page with `?posted=<id>` or `?error=<code>`. Also for `POST /login` and `POST /logout`: those are the web UI's log-in and log-out routes, not feeds, so a script gets a redirect, and nothing is stored |
| `500` | The note could not be written. No partial file is left behind. |
| `507` | A cap is reached: a new feed when there are already `NOTEFEED_MAX_FEEDS` feeds, or a note to a feed that already has `NOTEFEED_MAX_NOTES_PER_FEED` notes, or an image to a feed that already has `NOTEFEED_MAX_IMAGES_PER_FEED` images |

Error responses are JSON: `{"error": "<short reason>", "code": "<code>"}`. The reason is for people; match on the status or the `code` (`invalid_feed`, `reserved_feed`, `auth`, `rate_limited`, `too_many_attempts`, `feed_limit`, `note_limit`, `image_limit`, `empty_note`, `too_large`, `unsupported_type`, `invalid_body`, `feed_exists`).

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
      curl -fsS --data-binary @- https://notes.example.com/homelab-7f3k2q9x4m8wz > /dev/null
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
