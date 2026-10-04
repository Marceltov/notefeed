# Command line

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
notefeed post "Result: ![](chart.png)" --attach out/chart.png   # a note with its pictures, in one request
notefeed post --attach out/a.png --attach out/b.png   # only pictures, no text
notefeed update 20260929T140512Z-backup-finished --title "Backup" --alt "…"
notefeed notes                             # the newest 20: time, title, URL
notefeed notes --limit 100 --json          # one JSON object per line
notefeed notes --tag ci                     # only notes with this tag
notefeed --version
```

Text that starts with `-`, like a list item, works as-is: `notefeed post "- buy milk"`. The usual `notefeed post -- "-x"` works too.

`post` prints the new note's URL. `--attach PATH` (repeatable) posts the pictures with the note in one request: any file name works (the name the text refers to is the file's own name, the type its extension; for a name with spaces write `<my chart.png>` or `my%20chart.png` in the text), and it prints the text note's URL first, then each picture's. With `--attach` and no text, only the pictures are posted and each picture's URL is printed once. The `--file` name is not stored as the note's original name when `--attach` is given. `edit` prints the edited note's URL; `edit` takes its text the same ways as `post`. `delete` prints nothing and exits `0` when the note is gone. `post --file PATH` sends the file as it is, with the type its extension says (`.md`, `.png`, `.jpg`, `.gif`, `.webp`) or `--type`. `update` sets `--title` and/or `--alt` and prints the note's URL. A note that does not exist is an exit code `1`, for `edit` and `delete` alike. Anyone who can post to a feed can edit and delete its notes, and a delete cannot be undone. `notes` prints one line per note, `2026-09-30T14:05:12Z  Backup finished  https://…`, with the time in UTC to the second (the same in both packages and in `--json`). On failure the command prints `notefeed: <reason>` to stderr and exits with:

| Exit code | Meaning |
|---|---|
| `0` | Done |
| `1` | The server refused (including a wrong password, a rate limit or a full cap), or couldn't be reached |
| `2` | Usage or configuration problem: no text, image path or `--attach`, an unreadable image file or `--attach` picture (or one that is not a picture), an unreadable or non-UTF-8 file or stdin, no URL or feed, an invalid feed name or `--limit`, a password with control characters |
