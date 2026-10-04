# notefeed

Post and read markdown notes on a [notefeed](https://github.com/Marceltov/notefeed) server from Python or the command line. Python 3.11 or newer.

```sh
pip install notefeed
export NOTEFEED_URL=https://notes.example.com NOTEFEED_FEED=homelab-7f3k2q9x4m8wz
notefeed post "# Backup finished"
backup.sh 2>&1 | notefeed post -
notefeed notes --limit 5
notefeed edit 20260929T140512Z-backup-finished "# Backup finished, verified"
notefeed delete 20260929T140512Z-backup-finished
```

```python
from notefeed import Client

client = Client("https://notes.example.com", feed="homelab-7f3k2q9x4m8wz")  # password="..." if the instance has one
created = client.post("# Deploy done\nversion 1.4.2")
print(created.url, created.read_url)
for note in client.notes():  # newest first, page by page
    print(note.created_at, note.title)
```

`read_url` is `None` for a feed without a read link (rare; see the operations docs).

`Client.from_env()` reads `NOTEFEED_URL` / `NOTEFEED_FEED` / `NOTEFEED_PASSWORD`; so does the `notefeed` command, unless given `--url` / `--feed` / `--password`.

A feed can have its own password, which gates reading, listing and posting to it. Pass `feed_password="..."` to `Client(...)` (or per call, e.g. `client.post(text, feed_password=...)`), or set `NOTEFEED_FEED_PASSWORD`, which `from_env()` and the `notefeed` command both read (there is deliberately no flag, so it stays out of shell history). It is sent as `X-Feed-Password`; `Authorization` stays the instance password. A feed password is 1 to 256 printable ASCII characters with no space at the start or end; an empty one is the same as none.

A posted note can be changed or removed: `client.edit(id, content)` replaces its content and returns the note (its id and URLs stay), and `client.delete(id)` removes it. Both take the same `feed` and `feed_password` arguments as `post`, and a missing note is a `NotFoundError`. `notefeed edit <id> <text | - | --file PATH>` prints the note URL; `notefeed delete <id>` prints nothing. Anyone who can post to a feed can edit and delete its notes, and deleting is permanent.

A feed can have a title and a description, and can be deleted: `client.feed_info()` returns the feed (`name`, `title`, `description`, `protected`, `read_url`), `client.update_feed(title, description)` replaces both (an empty string clears one) and returns the feed, and `client.delete_feed()` removes the feed with all its notes for good. All three take the same `feed` and `feed_password` arguments as `post`, and a feed that doesn't exist is a `NotFoundError`. Anyone who can post to a feed can do this, and deleting is permanent; there are no `notefeed` commands for it.

A picture is a note of its own: `client.post(data, type="image/png", alt="…")` takes `bytes` (PNG, JPEG, GIF or WebP) and returns what a markdown post returns, with the picture's `file` and `file_url` added. Write `![](file)` in a markdown note to show it; the feed is created by its first note, and a picture that is too large is a `NoteTooLargeError`. The server checks the bytes against the declared type. `client.update(id, title=..., alt=...)` changes a note's title or a picture's alt text, and `client.edit(id, content)` replaces its content. `client.update_feed(title, description, image=file)` makes a picture the feed's title image (`image=""` removes it; leaving `image` out keeps it). `notefeed post --file photo.png` posts a file (the type comes from the extension, or `--type`). To post a note with its pictures in one call, `client.post(text, attachments=[Attachment("chart.png", data, "image/png")])` posts them with the text in one request, and the server swaps `![](chart.png)` for each file name (`None` content posts only the pictures) (`notefeed post "…" --attach chart.png` does the same); nothing is posted when one is refused. Pictures are public to anyone with the feed's read link, and metadata such as EXIF is not removed.

Full documentation: https://docs.notefeed.me/integrations/clients/
