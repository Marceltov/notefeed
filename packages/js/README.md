# notefeed

Post markdown notes to a [notefeed](https://github.com/Marceltov/notefeed) server from Node or the command line. No dependencies; Node 20 or newer.

```sh
npm install notefeed
export NOTEFEED_URL=https://notes.example.com NOTEFEED_TOKEN=...
npx notefeed post "# Backup finished"
backup.sh 2>&1 | npx notefeed post -
```

```js
import { Client } from "notefeed";

const client = new Client({ url: "https://notes.example.com", token }); // URL and token set once
console.log((await client.post("# Deploy done\nversion 1.4.2")).url);
```

The `notefeed` command reads `--url` / `--token`, or `NOTEFEED_URL` / `NOTEFEED_TOKEN`. The library itself never reads the environment.

Full documentation: https://notefeed.marceltov.de/clients/
