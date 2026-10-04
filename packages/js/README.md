# notefeed

Post and read markdown notes on a [notefeed](https://github.com/Marceltov/notefeed) server from Node or the command line. No dependencies; Node 20 or newer.

```sh
npm install notefeed
export NOTEFEED_URL=https://notes.example.com NOTEFEED_FEED=homelab-7f3k2q9x4m8wz
npx notefeed post "# Backup finished"
backup.sh 2>&1 | npx notefeed post -
npx notefeed notes --limit 5
npx notefeed edit 20260929T140512Z-backup-finished "# Backup finished, verified"
npx notefeed delete 20260929T140512Z-backup-finished
```

```js
import { Client } from "notefeed";

const client = new Client({ url: "https://notes.example.com", feed: "homelab-7f3k2q9x4m8wz" }); // password: "..." if the instance has one
const created = await client.post("# Deploy done\nversion 1.4.2");
console.log(created.url, created.read_url);
for await (const note of client.notes()) console.log(note.created_at, note.title); // newest first, page by page
```

`read_url` is `null` for a feed without a read link (rare; see the operations docs).

`Client.fromEnv()` reads `NOTEFEED_URL` / `NOTEFEED_FEED` / `NOTEFEED_PASSWORD`; so does the `notefeed` command, unless given `--url` / `--feed` / `--password`.

A feed can have its own password, which gates reading, listing and posting to it. Pass `feedPassword: "..."` to `new Client(...)` (or per call, e.g. `client.post(text, { feedPassword })`), or set `NOTEFEED_FEED_PASSWORD`, which `fromEnv()` and the `notefeed` command both read (there is deliberately no flag, so it stays out of shell history). It is sent as `X-Feed-Password`; `Authorization` stays the instance password. A feed password is 1 to 256 printable ASCII characters with no space at the start or end; an empty one is the same as none.

A posted note can be changed or removed: `await client.edit(id, content)` replaces its content and returns the note (its id and URLs stay), and `await client.delete(id)` removes it. Both take the same `{ feed, feedPassword }` options as `post`, and a missing note is a `NotFoundError`. `notefeed edit <id> <text | - | --file PATH>` prints the note URL; `notefeed delete <id>` prints nothing. Anyone who can post to a feed can edit and delete its notes, and deleting is permanent.

A feed can have a title and a description, and can be deleted: `await client.feedInfo()` returns `{ name, title, description, protected, read_url }`, `await client.updateFeed({ title, description })` replaces both (an empty string clears one) and returns the feed, and `await client.deleteFeed()` removes the feed with all its notes for good. All three take the same `{ feed, feedPassword }` options as `post`, and a feed that doesn't exist is a `NotFoundError`. Anyone who can post to a feed can do this, and deleting is permanent; there are no `notefeed` commands for it.

A picture is a note of its own: `await client.post(bytes, { type: "image/png", alt: "…" })` takes a `Uint8Array` or a `Blob` (PNG, JPEG, GIF or WebP; a Blob's own type is used if you leave `type` out) and returns what a markdown post returns, with the picture's `file` and `file_url` added. Write `![](file)` in a markdown note to show it; the feed is created by its first note, and a picture that is too large is a `NoteTooLargeError`. The server checks the bytes against the declared type. `await client.update(id, { title, alt })` changes a note's title or a picture's alt text, and `await client.edit(id, content)` replaces its content. `await client.updateFeed({ title, description, image: file })` makes a picture the feed's title image (`image: ""` removes it; leaving `image` out keeps it). `notefeed post --file photo.png` posts a file (the type comes from the extension, or `--type`). To post a note with its pictures in one call, `await client.post(text, { attachments: [{ name: "chart.png", content: bytes, type: "image/png" }] })` posts them with the text in one request, and the server swaps `![](chart.png)` for each file name (`null` content posts only the pictures) (`notefeed post "…" --attach chart.png` does the same); nothing is posted when one is refused. Pictures are public to anyone with the feed's read link, and metadata such as EXIF is not removed.

Full documentation: https://docs.notefeed.me/integrations/clients/
