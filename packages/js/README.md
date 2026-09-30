# notefeed

Post markdown notes to a [notefeed](https://github.com/Marceltov/notefeed) server from Node or the command line. No dependencies; Node 20 or newer.

```sh
npm install notefeed
export NOTEFEED_URL=https://notes.example.com NOTEFEED_FEED=homelab-7f3k2
npx notefeed post "# Backup finished"
backup.sh 2>&1 | npx notefeed post -
```

```js
import { Client } from "notefeed";

const client = new Client({ url: "https://notes.example.com", feed: "homelab-7f3k2" }); // password: "..." if the instance has one
const note = await client.post("# Deploy done\nversion 1.4.2");
console.log(note.url, note.readUrl);
await client.post("# Disk at 91%", { feed: "alerts-q9x2m" }); // another feed, same client
```

The `notefeed` command reads `--url` / `--feed` / `--password`, or `NOTEFEED_URL` / `NOTEFEED_FEED` / `NOTEFEED_PASSWORD`. The library itself never reads the environment.

Full documentation: https://docs.notefeed.me/clients/
