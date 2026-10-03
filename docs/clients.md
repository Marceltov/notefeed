# Client libraries

For Python and Node there are client packages, both called `notefeed`. They post, edit and delete notes, read a feed back page by page, and each comes with a `notefeed` command.

Under the hood both are generated from the server's [OpenAPI description](api.md) and wrapped in a small hand-written `Client`. Any other language can generate its own client from `/api/v1/openapi.json`.

## Install

=== "Python"

    ```sh
    pip install notefeed        # Python 3.11 or newer; brings httpx
    ```

=== "Node"

    ```sh
    npm install notefeed        # Node 20 or newer; no dependencies
    # or run the command without installing:
    npx notefeed post "# Hello" --url https://notes.example.com --feed homelab-7f3k2q9x4m8wz
    ```

## From code

Create the client with the server's URL and, usually, a default feed. Every call can name another feed. Pass the password only if the instance has one. `Client.from_env()` / `Client.fromEnv()` reads `NOTEFEED_URL`, `NOTEFEED_FEED` and `NOTEFEED_PASSWORD` instead.

Notes can carry [tags](posting.md#tags): pass `tags=["ci", "deploy"]` (Python) or `{ tags: ["ci", "deploy"] }` (Node) to `post`, and `tag="ci"` / `{ tag: "ci" }` to `notes` and `read_notes` / `readNotes` to list only those. Each `Note` has a `tags` list.

A feed can also have its own password (see [A feed with its own password](posting.md#a-feed-with-its-own-password)). Pass `feed_password=` (Python) or `feedPassword:` (Node) to the client, or per call, for example `client.post(text, feed_password=...)`; `edit`, `delete`, `feed_info`, `update_feed` and `delete_feed` take the same option. It is sent as `X-Feed-Password`; the `password` option stays the instance password. Posting to a new feed with `feed_password` creates it protected; the server accepts 1 to 256 printable ASCII characters with no space at the start or end, and an empty value is the same as none. `from_env()` / `fromEnv()` and the command read `NOTEFEED_FEED_PASSWORD`.

=== "Python"

    ```python
    import os
    from notefeed import Client, NotefeedError

    client = Client(
        "https://notes.example.com",
        feed="homelab-7f3k2q9x4m8wz",
        password=os.environ.get("MY_NOTEFEED_PASSWORD"),  # None: the instance is open
    )  # timeout=10 by default; use `with Client(...) as client:` or client.close() to free connections
    try:
        created = client.post("# Deploy done\nimmich v3.2.4 on host-2")
        print(created.id, created.url, created.read_url)
        client.post("# Disk at 91%", feed="alerts-q9x2m7hd4k1pv")  # another feed

        for note in client.notes():  # newest first, fetched a page at a time
            print(note.created_at, note.title)
            if note.title == "Deploy done":
                break
    except NotefeedError as e:
        print("notefeed failed:", e, e.status, e.code)
    ```

=== "Node"

    ```js
    import { Client, NotefeedError } from "notefeed";

    const client = new Client({
      url: "https://notes.example.com",
      feed: "homelab-7f3k2q9x4m8wz",
      password: process.env.MY_NOTEFEED_PASSWORD, // undefined: the instance is open
    }); // timeoutMs: 10000 by default
    try {
      const created = await client.post("# Deploy done\nimmich v3.2.4 on host-2");
      console.log(created.id, created.url, created.read_url);
      await client.post("# Disk at 91%", { feed: "alerts-q9x2m7hd4k1pv" }); // another feed

      for await (const note of client.notes()) { // newest first, fetched a page at a time
        console.log(note.created_at, note.title);
        if (note.title === "Deploy done") break;
      }
    } catch (e) {
      if (e instanceof NotefeedError) console.error("notefeed failed:", e.message, e.status, e.code);
      else throw e;
    }
    ```

| Python | Node | Does |
|---|---|---|
| `post(content, feed=None, type=None, title=None, tags=None, alt=None, name=None, read_id=None)` | `post(content, { feed, type, title, tags, alt, name, readId })` | Posts a note. A string is markdown; bytes (`bytes` in Python, a `Uint8Array` or `Blob` in Node) are a file whose media type is `type` (`text/markdown`, `image/png`, `image/jpeg`, `image/gif` or `image/webp`; a Blob's own type is used if you leave it out). Returns `id`, `url`, `feed_url`, `read_url` (`None`/`null` for a feed without a read link), and the note's `file` and `file_url`: write `![](file)` in a markdown note to show a picture, or pass it as `image` to `update_feed`. See [Types](posting.md#types) and [Pictures](posting.md#pictures). A refused file is an `InvalidRequestError` (not accepted, or not what the type says), `NoteTooLargeError` (too large) or `LimitReachedError` (the feed's picture cap) |
| `notes(feed=None, page_size=50)` | `notes({ feed, pageSize })` | Every note in the feed, newest first. It fetches the next page only as you iterate, so stop whenever you have enough |
| `note(id, feed=None)` | `note(id, { feed })` | One note |
| `edit(id, content, feed=None, type=None)` | `edit(id, content, { feed, type })` | Replaces a note's content and returns the note: a string is markdown, bytes need the note's own `type`. Its id, URLs and metadata stay. A missing note is a `NotFoundError` |
| `update(id, title=None, alt=None, feed=None)` | `update(id, { title, alt }, { feed })` | Sets a note's [title](posting.md#titles) and/or a picture's alt text; `""` removes one, so a markdown note's title follows its text again. Returns the note |
| `delete(id, feed=None)` | `delete(id, { feed })` | Deletes a note for good; returns nothing. The feed stays, even with no notes left. A missing note is a `NotFoundError` |
| `feed_info(feed=None)` | `feedInfo({ feed })` | The feed's `name`, `title`, `description`, `image_url`, `protected` and `read_url` (`None`/`null` while it has no notes or no title image) |
| `update_feed(title, description, feed=None, image=None)` | `updateFeed({ title, description, image }, { feed })` | Replaces the feed's title and description, both at once (an empty string clears one), and returns the feed. `image` is the `file` of an image note to use as the title image; `""` removes it, and leaving it out keeps it. The feed must already exist |
| `delete_feed(feed=None)` | `deleteFeed({ feed })` | Deletes the feed with all its notes, settings, password and read link, for good; returns nothing. The name is free again |
| `read_notes(read_id, page_size=50)` | `readNotes(readId, { pageSize })` | Like `notes()`, by the feed's [read id](feed.md): public, needs no password, never needs the name |
| `read_note(read_id, id)` | `readNote(readId, id)` | One note by read id |

The feed methods have no command-line counterpart. `feed_info` and `update_feed` return the feed as an object with `name`, `title`, `description`, `image_url`, `protected` and `read_url` (named the same in both packages). Anyone who can post to a feed can change its settings and delete it, and a delete cannot be undone.

A note has `id`, `type` (its media type), `title`, `content` (the text of a text type; absent for a picture), `file`, `file_url`, `size`, `tags`, `created_at` (a `datetime` in Python, an ISO string in Node) and `url`, its page in the web UI. Optional: `alt`, `name`, `sender`.

**Timeouts** default to 10 seconds, with one difference. In Python (httpx) the limit applies to connecting and to each read or write separately, so a server that keeps sending slowly doesn't trip it. In Node it covers the whole request.

The feed is the call's if given, else the client's. With neither, the call raises `ConfigError` without sending anything. Feed names are checked on the client too (1–64 of `a`–`z`, `0`–`9`, `-`, `_`), so a typo fails with a clear `ConfigError` instead of a round trip. Reserved names come back from the server as `InvalidRequestError`.

Keep the password and the feed name out of source code, for example in an environment variable or a secrets store.

## From the command line

The command takes its settings from flags, or else from these environment variables:

| Flag | Variable | Meaning |
|---|---|---|
| `--url` | `NOTEFEED_URL` | notefeed's base URL, e.g. `https://notes.example.com` |
| `--feed` | `NOTEFEED_FEED` | the feed |
| `--password` | `NOTEFEED_PASSWORD` | the instance password (`NOTEFEED_PASSWORD` on the server), only if it has one |

A feed's own password is read from `NOTEFEED_FEED_PASSWORD`, and has no flag at all. Prefer the environment variables for the passwords and the feed name: flag values are visible to other users of the machine in the process list.

```sh
export NOTEFEED_URL=https://notes.example.com NOTEFEED_FEED=homelab-7f3k2q9x4m8wz
notefeed post "# Backup finished"          # the text as an argument
backup.sh 2>&1 | notefeed post -           # from stdin
notefeed post --file report.md             # from a file
notefeed post "# Deployed" --tag ci --tag deploy   # with tags
notefeed post "# Disk at 91%" --feed alerts-q9x2m7hd4k1pv
notefeed edit 20260929T140512Z-backup-finished "# Backup finished, verified"
notefeed edit 20260929T140512Z-backup-finished --file report.md   # or "-" for stdin
notefeed delete 20260929T140512Z-backup-finished
notefeed post --file photo.png --title Cat # a picture is a note too (the type comes from the extension)
notefeed update 20260929T140512Z-backup-finished --title "Backup" --alt "…"
notefeed notes                             # the newest 20: time, title, URL
notefeed notes --limit 100 --json          # one JSON object per line
notefeed notes --tag ci                     # only notes with this tag
notefeed --version
```

Text that starts with `-`, like a list item, works as-is: `notefeed post "- buy milk"`. The usual `notefeed post -- "-x"` works too.

`post` prints the new note's URL, and `edit` prints the edited note's URL; `edit` takes its text the same ways as `post`. `delete` prints nothing and exits `0` when the note is gone. `post --file PATH` sends the file as it is, with the type its extension says (`.md`, `.png`, `.jpg`, `.gif`, `.webp`) or `--type`. `update` sets `--title` and/or `--alt` and prints the note's URL. A note that does not exist is an exit code `1`, for `edit` and `delete` alike. Anyone who can post to a feed can edit and delete its notes, and a delete cannot be undone. `notes` prints one line per note, `2026-09-30T14:05:12Z  Backup finished  https://…`, with the time in UTC to the second (the same in both packages and in `--json`). On failure the command prints `notefeed: <reason>` to stderr and exits with:

| Exit code | Meaning |
|---|---|
| `0` | Done |
| `1` | The server refused (including a wrong password, a rate limit or a full cap), or couldn't be reached |
| `2` | Usage or configuration problem: no text or image path, an unreadable image file, an unreadable or non-UTF-8 file or stdin, no URL or feed, an invalid feed name or `--limit`, a password with control characters |

## Errors

Every error is a `NotefeedError` with `status` (the HTTP status) and `code` (the API's error code). Both are `None`/`null` for network and configuration problems, and `code` is also empty when the answer wasn't the API's (an HTML error page from a proxy, for example). The type follows the code:

| Type | Codes | When |
|---|---|---|
| `ConfigError` | – | Empty URL; no feed given; an invalid feed name; a password with control characters (the password itself is never shown) |
| `InvalidRequestError` | `invalid_feed`, `reserved_feed`, `empty_note`, `invalid_body`, `invalid_request`, `unsupported_type` | The server refused the request itself |
| `AuthError` | `auth` | The instance or the feed has a password and it's missing or wrong |
| `NotFoundError` | `not_found` | No such note (also for `edit` and `delete`), no such feed (for `feed_info`, `update_feed` and `delete_feed`), or a malformed read id |
| `NoteTooLargeError` | `too_large` | A note over 100 KB, or an image over the size limit |
| `RateLimitedError` | `rate_limited`, `too_many_attempts` | Too many posts or wrong passwords. `retry_after` / `retryAfter` is the wait in seconds from `Retry-After`, or `None`/`null` |
| `LimitReachedError` | `feed_limit`, `note_limit`, `image_limit` | The instance's feed cap, or the feed's note or image cap, is reached |

The message is the server's own reason. See the [REST API](api.md) for every status and code.

## Upgrading from 0.4

0.5 uses the versioned API (`/api/v1`), so it needs a notefeed server that has it:

- `post()` returns `Created` (`id`, `url`, `feed_url`, `read_url`); in 0.4 that type was called `Note`. `Note` is now a full note from the feed (`title`, `markdown`, `created_at`, …). In Node, `readUrl` is now `read_url`, as in the API, and the `PostOptions` type is gone (`post(markdown, { feed })` still works).
- `InvalidNoteError` is now `InvalidRequestError`. Errors carry `code` (in Node, `RateLimitedError`'s constructor takes it before `retryAfter`), and there's a new `NotFoundError`.
- A server that redirects (for example `http://` to `https://`) is now an error that names the address to use, in both packages. In Node it used to be followed.
- New: `notes()`, `note()`, `read_notes()` / `readNotes()`, `read_note()` / `readNote()`, `from_env()` / `fromEnv()`, and `notefeed notes`.
- Python needs 3.11 or newer and now depends on httpx and attrs.
