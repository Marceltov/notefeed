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
- `read_url`: the feed's read-only RSS link, for feed readers and for sharing. See [Read links and RSS](feed.md).

!!! tip "Use `--data-binary`, not `-d`"
    `curl -d` strips newlines from files. `--data-binary` sends the file unchanged.

## Feed names

A feed name is 1 to 64 characters of `a`–`z`, `0`–`9`, `-` and `_`. Anything else is rejected with `400`. These names are taken by notefeed itself and are reserved: `r`, `api`, `login`, `logout`, `mcp`, `n`, `_next`, `static`, `health`. Posting to a reserved name answers `400`, except `logout`: that's the web UI's log-out route, which answers with a redirect and stores nothing. A trailing slash is fine: `POST /<feed>/` works like `POST /<feed>`.

!!! warning "The name is the key"
    Anyone who knows a feed's name can read it and post to it. Pick one that's hard to guess, like `homelab-7f3k2q9x4m8wz`, and share the read link instead of the name.

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
| `404` | No feed in the URL: `POST /`, for example from an empty variable in `$NOTEFEED_URL/$FEED` |
| `413` | The body is larger than 100 KB (102400 bytes) |
| `415` | The content type is not one of those above |
| `429` | Too many posts, or too many wrong passwords, from this client in the last minute. `Retry-After` says how many seconds to wait. See [Rate limits and caps](configuration.md#rate-limits-and-caps). |
| `303` | The request asked for HTML (`Accept: text/html`, as a browser submitting a form does): back to the feed page with `?posted=<id>` or `?error=<code>`. Also for `POST /login` and `POST /logout`: those are the web UI's log-in and log-out routes, not feeds, so a script gets a redirect, and nothing is stored |
| `500` | The note could not be written. No partial file is left behind. |
| `507` | A cap is reached: a new feed when there are already `NOTEFEED_MAX_FEEDS` feeds, or a note to a feed that already has `NOTEFEED_MAX_NOTES_PER_FEED` notes |

Error responses are JSON: `{"error": "<short reason>", "code": "<code>"}`. The reason is for people; match on the status or the `code` (`invalid_feed`, `reserved_feed`, `auth`, `rate_limited`, `too_many_attempts`, `feed_limit`, `note_limit`, `empty_note`, `too_large`, `unsupported_type`, `invalid_body`, `feed_exists`).

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
