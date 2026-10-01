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
| `400` | The feed name is invalid or reserved; the note is empty; the JSON is invalid or has no string `markdown`; the body is not UTF-8 |
| `401` | The instance has a password and the `Authorization` header is missing or wrong |
| `404` | No feed in the URL: `POST /`, for example from an empty variable in `$NOTEFEED_URL/$FEED` |
| `413` | The body is larger than 100 KB (102400 bytes) |
| `415` | The content type is not one of those above |
| `429` | Too many posts, or too many wrong passwords, from this client in the last minute. `Retry-After` says how many seconds to wait. See [Rate limits and caps](configuration.md#rate-limits-and-caps). |
| `303` | The request asked for HTML (`Accept: text/html`, as a browser submitting a form does): back to the feed page with `?posted=<id>` or `?error=<code>`. Also for `POST /login` and `POST /logout`: those are the web UI's log-in and log-out routes, not feeds, so a script gets a redirect, and nothing is stored |
| `500` | The note could not be written. No partial file is left behind. |
| `507` | A cap is reached: a new feed when there are already `NOTEFEED_MAX_FEEDS` feeds, or a note to a feed that already has `NOTEFEED_MAX_NOTES_PER_FEED` notes |

Error responses are JSON: `{"error": "<short reason>", "code": "<code>"}`. The reason is for people; match on the status or the `code` (`invalid_feed`, `reserved_feed`, `auth`, `rate_limited`, `too_many_attempts`, `feed_limit`, `note_limit`, `empty_note`, `too_large`, `unsupported_type`, `invalid_body`).

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
