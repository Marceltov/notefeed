# Client libraries

For Python and Node there are small client packages, both called `notefeed`. They post a note to a feed and tell you its URLs, and each comes with a `notefeed` command. Neither has any dependencies.

## Install

=== "Python"

    ```sh
    pip install notefeed        # Python 3.10 or newer
    ```

=== "Node"

    ```sh
    npm install notefeed        # Node 20 or newer
    # or run the command without installing:
    npx notefeed post "# Hello" --url https://notes.example.com --feed homelab-7f3k2q9x4m8wz
    ```

## From code

Create the client with the server's URL and, usually, a default feed. `post()` can name another feed for a single note. Pass the password only if the instance has one.

=== "Python"

    ```python
    import os
    from notefeed import Client, NotefeedError

    client = Client(
        "https://notes.example.com",
        feed="homelab-7f3k2q9x4m8wz",
        password=os.environ.get("MY_NOTEFEED_PASSWORD"),  # None: the instance is open
    )  # timeout=10 by default
    try:
        note = client.post("# Deploy done\nimmich v3.2.4 on host-2")
        print(note.id, note.url, note.read_url)
        client.post("# Disk at 91%", feed="alerts-q9x2m7hd4k1pv")  # another feed
    except NotefeedError as e:
        print("notefeed failed:", e, e.status)
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
      const note = await client.post("# Deploy done\nimmich v3.2.4 on host-2");
      console.log(note.id, note.url, note.readUrl);
      await client.post("# Disk at 91%", { feed: "alerts-q9x2m7hd4k1pv" }); // another feed
    } catch (e) {
      if (e instanceof NotefeedError) console.error("notefeed failed:", e.message, e.status);
      else throw e;
    }
    ```

The feed is `post()`'s feed if given, else the client's. With neither, `post()` raises `ConfigError` without sending anything. Feed names are checked on the client too (1–64 of `a`–`z`, `0`–`9`, `-`, `_`), so a typo fails with a clear `ConfigError` instead of a round trip. Reserved names still come back from the server as `400` (`InvalidNoteError`), except `logout`, the web UI's log-out route: posting there stores nothing and fails with a plain `NotefeedError` ("unexpected response").

A note has `id`, `url` (its page in the web UI) and `read_url` / `readUrl` (the feed's [read link](feed.md)).

The libraries never read environment variables themselves; where the URL, feed and password come from is up to your program. Keep the password and the feed name out of source code, for example in an environment variable or a secrets store.

## From the command line

The command takes its settings from flags, or else from these environment variables:

| Flag | Variable | Meaning |
|---|---|---|
| `--url` | `NOTEFEED_URL` | notefeed's base URL, e.g. `https://notes.example.com` |
| `--feed` | `NOTEFEED_FEED` | the feed to post to |
| `--password` | `NOTEFEED_PASSWORD` | the instance password (`NOTEFEED_PASSWORD` on the server), only if it has one |

Prefer the environment variables for the password and the feed name: flag values are visible to other users of the machine in the process list.

```sh
export NOTEFEED_URL=https://notes.example.com NOTEFEED_FEED=homelab-7f3k2q9x4m8wz
notefeed post "# Backup finished"          # the text as an argument
backup.sh 2>&1 | notefeed post -           # from stdin
notefeed post --file report.md             # from a file
notefeed post "# Disk at 91%" --feed alerts-q9x2m7hd4k1pv
notefeed --version
notefeed post --help
```

Text that starts with `-`, like a list item, works as-is: `notefeed post "- buy milk"`. The usual `notefeed post -- "-x"` works too.

It prints the new note's URL. On failure it prints `notefeed: <reason>` to stderr and exits with:

| Exit code | Meaning |
|---|---|
| `0` | Posted |
| `1` | The server refused the note (including a wrong password, a rate limit or a full cap), or couldn't be reached |
| `2` | Usage or configuration problem: no text, an unreadable or non-UTF-8 file or stdin, no URL or feed (neither flag nor environment variable), an invalid feed name, a password with control characters |

## Errors

Every error is a `NotefeedError` with a `status` (the HTTP status, or `None`/`null` for network and configuration problems). More specific types:

| Type | When |
|---|---|
| `ConfigError` | Empty URL; no feed given; an invalid feed name; a password with control characters (the password itself is never shown) |
| `InvalidNoteError` | `400` or `415`: empty note, not UTF-8, reserved feed name |
| `AuthError` | `401`: the instance has a password and it's missing or wrong |
| `NoteTooLargeError` | `413`: over 100 KB |
| `RateLimitedError` | `429`: too many posts or wrong passwords. `retry_after` / `retryAfter` is the wait in seconds from the `Retry-After` header, or `None`/`null` |
| `LimitReachedError` | `507`: the instance's feed cap or the feed's note cap is reached |

The message is the server's own reason. See [Posting notes](posting.md#errors) for what each status means.

## Upgrading from 0.3

0.4 posts to feeds instead of the old single `/api/notes`, and needs a notefeed server of 0.4 or newer:

- `Client(url, token)` is now `Client(url, feed=None, password=None)` (Python) and `new Client({ url, feed?, password? })` (Node). There is no token; the password is only needed on a locked instance.
- `post()` takes an optional feed, and the returned note has `read_url` / `readUrl`.
- The command's `--token` / `NOTEFEED_TOKEN` are gone; use `--feed` / `NOTEFEED_FEED`, and `--password` / `NOTEFEED_PASSWORD` if needed.
