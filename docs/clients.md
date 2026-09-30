# Client libraries

For Python and Node there are small client packages, both called `notefeed`. They post a note and tell you its URL, and each comes with a `notefeed` command. Neither has any dependencies.

## Install

=== "Python"

    ```sh
    pip install notefeed        # Python 3.10 or newer
    ```

=== "Node"

    ```sh
    npm install notefeed        # Node 20 or newer
    # or run the command without installing:
    npx notefeed post "# Hello"
    ```

## From code

Give the server's URL and the token once, when you create the client. After that, `post()` takes only the note.

=== "Python"

    ```python
    import os
    from notefeed import Client, NotefeedError

    client = Client("https://notes.example.com", os.environ["MY_NOTEFEED_TOKEN"])  # timeout=10 by default
    try:
        note = client.post("# Deploy done\nversion 1.4.2 on host-2")
        print(note.id, note.url)
    except NotefeedError as e:
        print("notefeed failed:", e, e.status)
    ```

=== "Node"

    ```js
    import { Client, NotefeedError } from "notefeed";

    const client = new Client({ url: "https://notes.example.com", token: process.env.MY_NOTEFEED_TOKEN }); // timeoutMs: 10000 by default
    try {
      const note = await client.post("# Deploy done\nversion 1.4.2 on host-2");
      console.log(note.id, note.url);
    } catch (e) {
      if (e instanceof NotefeedError) console.error("notefeed failed:", e.message, e.status);
      else throw e;
    }
    ```

The libraries never read environment variables themselves; where the token comes from is up to your program. Keep it out of source code, for example in an environment variable or a secrets store, as above.

## From the command line

The command takes the server and token from `--url` / `--token`, or else from these environment variables:

| Variable | Meaning |
|---|---|
| `NOTEFEED_URL` | notefeed's base URL, e.g. `https://notes.example.com` |
| `NOTEFEED_TOKEN` | the API token (`NOTEFEED_TOKEN` on the server) |

Prefer the environment variable for the token: a `--token` value is visible to other users of the machine in the process list.

```sh
export NOTEFEED_URL=https://notes.example.com NOTEFEED_TOKEN=...
notefeed post "# Backup finished"          # the text as an argument
backup.sh 2>&1 | notefeed post -           # from stdin
notefeed post --file report.md             # from a file
notefeed post "# Hi" --url https://notes.example.com --token "$TOKEN"
notefeed --version
notefeed post --help
```

Text that starts with `-`, like a list item, works as-is: `notefeed post "- buy milk"`. The usual `notefeed post -- "-x"` works too.

It prints the new note's URL. On failure it prints `notefeed: <reason>` to stderr and exits with:

| Exit code | Meaning |
|---|---|
| `0` | Posted |
| `1` | The server refused the note, or couldn't be reached |
| `2` | Usage or configuration problem: no text, an unreadable or non-UTF-8 file or stdin, no URL or token (neither flag nor environment variable), a token with control characters |

## Errors

Every error is a `NotefeedError` with a `status` (the HTTP status, or `None`/`null` for network and configuration problems). More specific types:

| Type | When |
|---|---|
| `ConfigError` | Empty URL or token passed to `Client`, or the token contains control characters (the token itself is never shown) |
| `InvalidNoteError` | `400` or `415`: empty note, not UTF-8 |
| `AuthError` | `401`: missing or wrong token |
| `NoteTooLargeError` | `413`: over 100 KB |

The message is the server's own reason. See [Posting notes](posting.md#errors) for what each status means.
