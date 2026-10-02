# notefeed

Post and read markdown notes on a [notefeed](https://github.com/Marceltov/notefeed) server from Node or the command line. No dependencies; Node 20 or newer.

```sh
npm install notefeed
export NOTEFEED_URL=https://notes.example.com NOTEFEED_FEED=homelab-7f3k2q9x4m8wz
npx notefeed post "# Backup finished"
backup.sh 2>&1 | npx notefeed post -
npx notefeed notes --limit 5
```

```js
import { Client } from "notefeed";

const client = new Client({ url: "https://notes.example.com", feed: "homelab-7f3k2q9x4m8wz" }); // password: "..." if the instance has one
const created = await client.post("# Deploy done\nversion 1.4.2");
console.log(created.url, created.read_url);
for await (const note of client.notes()) console.log(note.created_at, note.title); // newest first, page by page
```

`Client.fromEnv()` reads `NOTEFEED_URL` / `NOTEFEED_FEED` / `NOTEFEED_PASSWORD`; so does the `notefeed` command, unless given `--url` / `--feed` / `--password`.

A feed can have its own password, which gates reading, listing and posting to it. Pass `feedPassword: "..."` to `new Client(...)` (or per call, e.g. `client.post(text, { feedPassword })`), or set `NOTEFEED_FEED_PASSWORD`, which `fromEnv()` and the `notefeed` command both read (there is deliberately no flag, so it stays out of shell history). It is sent as `X-Feed-Password`; `Authorization` stays the instance password. A feed password is 1 to 256 printable ASCII characters with no space at the start or end; an empty one is the same as none.

Full documentation: https://docs.notefeed.me/clients/
