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

const note = await new Client().post("# Deploy done\nversion 1.4.2"); // reads NOTEFEED_URL / NOTEFEED_TOKEN
console.log(note.url);
```

Full documentation: https://marceltov.github.io/notefeed/clients/
