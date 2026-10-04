# Operations

## Where notes live

Every feed is a folder in `DATA_DIR` (`/data` in the container), named after the feed, and every note is a file in it, named `<id>.<ext>`: `.md` for a markdown note, `.png`, `.jpg`, `.gif` or `.webp` for an image. The file is the note exactly as posted. The note's metadata (sender, tags, title, an image's alternative text and original name) is in a small JSON file next to it, `.<id>.<ext>.json`; a note without any has none.

```
data/
├── .secret                                  # signs cookies and tokens, and is behind older feeds' read links; back it up
├── homelab-7f3k2q9x4m8wz/
│   ├── .readid                              # the feed's read id (feeds created since feed deletion was added; older ones have none). A reserved feed's holds its name
│   ├── .feed.json                           # title, description and title image, if set
│   ├── .password                            # only on a protected feed
│   ├── 20260929T140512Z-backup-finished.md
│   ├── .20260929T140512Z-backup-finished.md.json   # its metadata, if it has any
│   ├── 20261003T101010Z-01a1013e-b2b6-7102-8a41-0d2f7a8b9c31.png   # an image note
│   └── 20260930T081500Z-deploy-done.md
└── alerts-q9x2m7hd4k1pv/
    └── 20260930T090210Z-disk-space-low.md
```

Every dot file in a feed's folder is the feed's or a note's metadata, and none is ever served or listed as a note. Three belong to the feed: `.readid` is its read link, `.feed.json` its title, description and title image, `.password` its [password](#a-lost-feed-password). They are plain files you can read and copy; don't edit `.readid` by hand, because the feed's read link changes with it. If you copy a feed's folder to make another feed, remove `.readid` from the copy: two feeds can't share a read link, and at the next start the folder whose name sorts first keeps it, which can be the copy, and the original's readers would then get the copy's notes. The other folder gets the read link computed from its name.

With the quick start's `compose.yaml` that's the `data` folder next to it. You can read, grep or copy the files directly.

notefeed writes them as the **owner of that folder**: create it yourself (`mkdir data`) and the notes are yours. To choose a different owner, set `PUID` and `PGID`. If Docker created the folder (owned by root), notefeed falls back to uid/gid 1000.

notefeed only reads folders with valid feed names and files named like notes. Anything else in `DATA_DIR`, such as `.git` or loose files, is ignored. So are symlinks, even to a folder: a feed must be a real folder inside `DATA_DIR`, so a link can't expose files from elsewhere on the disk.

## Images and other files

An image is a note: its file is in the feed's folder next to the markdown notes, stored exactly as posted, with its metadata beside it. Back them up with the rest of `data`: a `tar` of `data` includes them. A note that links to an image that was lost shows a broken image.

A file you put in the folder yourself is a note too, if its name is a name without dots, a dot, and an extension notefeed knows (`holiday.png`, `todo.md`): it is listed, dated by `created` in an optional metadata file (an ISO time) and otherwise by the file's modification time, and served under the read link. Ids are not enforced; the ones notefeed makes are a UTC time and a random UUID.

Two things to know:

- **Metadata stays.** notefeed does not resize, re-encode or clean images, so EXIF data in a photo, including GPS position, camera and time, is in the stored file and in what readers download. The image is public to anyone with the feed's read link, so strip metadata before posting if the photo is sensitive. For example, `exiftool -all= photo.jpg` removes it.
- **Deleting an image note deletes the file.** Deleting a note that merely shows an image does not: the image is a note of its own. If an image was the feed's title image, deleting it clears the title image.

To remove one by hand, delete the file and the metadata file next to it (content first):

```sh
ls -l data/homelab-7f3k2q9x4m8wz/*.png
rm data/homelab-7f3k2q9x4m8wz/20261003T101010Z-01a1013e-b2b6-7102-8a41-0d2f7a8b9c31.png \
   data/homelab-7f3k2q9x4m8wz/.20261003T101010Z-01a1013e-b2b6-7102-8a41-0d2f7a8b9c31.png.json
```

## Keeping notes in git

Since the notes are your files, `data` can be a git repository:

```sh
cd data
git init
git add -A && git commit -m "notes"
```

Leave `.secret` out if the repository goes anywhere public (`echo .secret > .gitignore`): with it, anyone can compute the read link of every feed that has no `.readid`, and sign their own unlock cookies and MCP logins. Keep the dot files inside the feed folders, and `.readid` in particular, out of a public repository too: `.readid` is the feed's read link, and `.password` is its password hash. They go into the repository with `git add -A`, so ignore them if the repository is public.

## Backups

Back up the `data` folder, including `.secret` and the dot files inside each feed folder: `.readid`, `.feed.json` and `.password`. There's no database: restoring the files restores the notes, the settings and the passwords. A backup that skips hidden files (a plain `cp *`, or a tool with a default exclude) loses them: a feed without its `.readid` gets the read link computed from its name and `.secret` instead, which is a different link for any feed created since feed deletion was added, and a feed without its `.password` is open. Restoring `.secret` keeps the read links of older feeds the same, and unlocked browsers and MCP clients signed in (unless `NOTEFEED_SECRET` is set, which then decides both). Restart notefeed after restoring: it reads the list of feeds once at startup, so the read links of restored feeds only work after a restart.

```sh
tar czf notefeed-notes.tgz -C data .
```

## Deleting notes and feeds

A feed's owner can delete it from the web UI or the [API](posting.md#feed-settings-and-deleting-a-feed). That removes the notes, the images, the settings, the password and the read link, frees the name, and takes the feed out of the `NOTEFEED_MAX_FEEDS` count at once. notefeed first renames the folder to `.deleted-<random>` in `DATA_DIR` and then removes it; if it stops in between, the leftover folder is removed at the next start. A new feed's folder is likewise made as `.<random>.tmp` and renamed into place, and one left by a crash is removed at the next start too.

Reserved feeds ([Configuration](configuration.md#reserved-feeds)) are created at every start if they are missing, so one deleted or removed by hand comes back, empty and with the same read link, at the next start. They count toward `NOTEFEED_MAX_FEEDS` like any feed.

You can also delete a note's file, or a feed's whole folder, yourself. It disappears from the web UI and the feed straight away. notefeed still lists a feed you removed by hand, as an empty feed that counts toward `NOTEFEED_MAX_FEEDS`, until someone posts to that name, deletes the feed, or notefeed restarts. A post to that name creates a new feed, with a new read link and no password.

```sh
rm data/homelab-7f3k2q9x4m8wz/20260929T140512Z-backup-finished.md
rm -r data/homelab-7f3k2q9x4m8wz
```

### A lost feed password

A feed with its own password keeps a salted scrypt hash in `DATA_DIR/<feed>/.password`. The file is read on every request, so deleting it opens the feed at once, with its notes intact, and no restart is needed. The feed's owner can then post to it again, but the password can't be set again: a password is only set when a feed is created.

```sh
rm data/homelab-7f3k2q9x4m8wz/.password
```

To keep a feed protected, copy its notes to a new feed created with a new password. Back up `.password` with the notes: it is part of the feed's folder.

### A feed that is empty and cannot get a password

If a feed's first note fails to save (a full disk, say), notefeed may leave an empty feed folder with its `.readid`. That is an existing, open feed with no notes: it counts toward `NOTEFEED_MAX_FEEDS`, and it cannot be given a password, because a password can only be set when a feed is created. Delete the feed and create it again. The easiest way is **Delete feed** on the feed's page in the web UI; `DELETE /api/v1/feeds/<feed>` or removing the folder do the same.

### A feed without a read link

If notefeed can't read a feed's `.readid` when it starts (wrong permissions, say), it logs that, without the feed's name, and lists the feed without a read link until the next start: the feed page shows none, and `read_url` and `image_url` are `null` in the API. Uploading an image to it is refused with `404`, because an image's URL is built from the read id. Posting and reading by name work as usual. notefeed does not fall back to another read id, because that would change the feed's link. Make the file readable and restart notefeed. The same happens to a feed whose `.readid` and computed read id both belong to other feeds, which takes two hand-made copies.

## Metrics

With `NOTEFEED_METRICS=1`, `GET /metrics` serves how long requests take, in the Prometheus text format ([Configuration](configuration.md) has the token setting; with a token, send `Authorization: Bearer <token>`). It exists to answer one question with data: is reading a feed slow enough to be worth an index or another storage? Off by default; nothing is measured while it is off. `metrics` is a reserved feed name.

The counters live in the app's memory and start at 0 again when the container restarts. That is what Prometheus expects: it keeps the history and treats a drop as a reset, so always query with `rate()` or `increase()`, never the raw values.

| Metric | What it shows |
|---|---|
| `notefeed_request_duration_seconds` | A histogram of the time a request took, by `kind`, `status` (`2xx`, `4xx`, `5xx`; a redirect counts as `2xx`) and `feed_size` (the notes of the feed it ran against: `lt10`, `lt100`, `lt1000`, `gte1000`, or `none` for a request that reads no feed). |
| `notefeed_request_dir_reads`, `notefeed_request_file_reads` | Histograms of the directory reads and file reads one request made, by `kind` and `feed_size`. Reading a note lists its feed's folder again, so these grow with the feed: they show the cost behind [#96](https://github.com/Marceltov/notefeed/issues/96) directly. |
| `notefeed_parse_duration_seconds`, `notefeed_parse_timeouts_total`, `notefeed_parse_waiting` | The worker that reads a text posted with pictures: how long reading took, how many texts were refused for time (`NOTEFEED_PARSE_TIMEOUT_MS`), and how many wait for a free worker now. |
| `notefeed_nodejs_eventloop_lag_*` | The event-loop lag: a stall of the main thread shows here. |
| `notefeed_process_*`, `notefeed_nodejs_*` | Node's default process metrics: memory, CPU, open handles, garbage collection. |

`kind` is a fixed name, never anything a client sent: the API's operation id (`listNotes`, `getNote`, `postNote`, `editNote`, and so on, as in the [API](api.md)), `<operation>_tag` for a listing filtered by `tag` (it reads every note until it has enough), `rss` for the feed's RSS, `feed_file` for a file of a feed, and `feed_page` and `feed_page_tag` for the feed's web page. Posting with pictures is `postNote` like any other post. Requests to an unknown path or with a wrong method, `/mcp`, sign-in and the read pages are not measured.

`feed_page` is the server's time to read the feed's notes for the page, not the time to send it: network and streaming are not in it, which is what you want to decide on storage. A page with a `tag` filter counts twice: the filtered read is `feed_page_tag`, and the page's title is read unfiltered, which is one `feed_page` sample, so `feed_page` counts include those views.

A feed that was already named `metrics` can no longer be opened by name, because `/metrics` is the scrape route. The start-up log names such a folder (`a feed folder is named like one of notefeed's routes`); rename it in `DATA_DIR` and restart.

No feed name, read id, note text, title, sender or address is ever a label or a value, so the number of series stays small whatever the traffic or the number of feeds.

### What counts as a problem

A rule of thumb to start from: the 95th percentile of `feed_page` over 200 ms for feeds under 1000 notes (`feed_size` below `gte1000`) means the reading of notes (#96) or an in-memory index is worth doing. A rising number of directory and file reads per request for `listNotes_tag` shows the tag filter reading the whole feed. Look at `rate()`s over a few days of real use before deciding.

### Scraping

Prometheus:

```yaml
scrape_configs:
  - job_name: notefeed
    metrics_path: /metrics
    authorization:
      credentials: <the value of NOTEFEED_METRICS_TOKEN>   # leave out without a token
    static_configs:
      - targets: ["notefeed:3000"]
```

InfluxDB takes the same endpoint through Telegraf:

```toml
[[inputs.prometheus]]
  urls = ["http://notefeed:3000/metrics"]
  http_headers = { "Authorization" = "Bearer <the value of NOTEFEED_METRICS_TOKEN>" }
  metric_version = 2
```

A starter Grafana dashboard (import it, pick the Prometheus data source): [grafana-notefeed.json](assets/grafana-notefeed.json). Its panels are the 95th percentile of `feed_page` by feed size, requests per second by kind, directory and file reads per request, texts refused for time and waiting, event-loop lag and memory.

## Logs

notefeed writes its logs to standard output as JSON lines: one object per line, with the level as a word (`level`), an ISO time (`time`), the part of notefeed that logged it (`component`), a fixed message (`msg`) and fields with the details. For example, the line at start-up:

```json
{"level":"info","time":"2026-10-02T09:00:00.120Z","component":"startup","node":"v22.23.3","dataDir":"/data","passwordSet":true,"oidcProviders":1,"publicUrlSet":true,"trustProxy":true,"maxFeeds":0,"maxNotesPerFeed":0,"maxImagesPerFeed":0,"logLevel":"info","metrics":false,"msg":"notefeed started"}
```

`NOTEFEED_LOG_LEVEL` sets how much is logged: `error`, `warn`, `info` (the default), `debug` or `silent`. Each level includes the ones before it. A value that isn't a level counts as `info`, and the start-up log warns about it.

Read the logs with `docker compose logs notefeed`, or your container runtime's equivalent; `docker compose logs -f notefeed` follows them. For lines a person can read, pipe them through pino-pretty, which `npx` fetches on first use: `docker compose logs --no-log-prefix notefeed | npx pino-pretty`. To pick lines out, filter on the JSON, for example `docker compose logs --no-log-prefix notefeed | grep '"level":"warn"'`, or with `jq`. Next.js prints a few plain lines of its own when the server starts.

| Level | `component` | `msg` | When |
|---|---|---|---|
| `info` | `startup` | `notefeed started` | Once, at start-up, with the Node version, `DATA_DIR`, whether the instance password, `PUBLIC_URL` and `NOTEFEED_TRUST_PROXY` are set, the number of sign-in providers, the caps and the log level. |
| `warn` | `startup` | `sign-in provider configured partially; it stays off` | At start-up, for each [sign-in provider](identity.md) with some but not all of its four variables set; `missing` names the variables that are missing. |
| `warn` | `startup` | `sign-in is on without PUBLIC_URL: the redirect URI comes from each request's Host header` | At start-up, when sign-in is on and `PUBLIC_URL` is not set. |
| `warn` | `startup` | `NOTEFEED_LOG_LEVEL is not a level; using info` | At start-up. |
| `warn` | `feeds` | `reserved feeds are listed but have no password; they are not created` | At start-up, when `NOTEFEED_RESERVED_FEEDS` is set and `NOTEFEED_RESERVED_PASSWORD` is not. |
| `warn` | `feeds` | `reserved feed exists but is not protected`, or `reserved feed exists with another read id than its name` | At start-up, for a [reserved feed](configuration.md#reserved-feeds) that already existed as an ordinary feed when its name was listed; `feed` is the reserved name and `hint` says what to do: delete its folder in `DATA_DIR` and restart, so it is recreated protected with its name as read id. With `NOTEFEED_RESERVED_PASSWORD` set, this check makes notefeed read its feeds and create the missing reserved feeds at start-up, rather than at the first request. |
| `info` | `oidc` | `sign-in succeeded` | A sign-in worked; `provider` is the provider's id. |
| `warn` | `oidc` | why a sign-in failed | See [What the log says](identity.md#what-the-log-says). |
| `info` | `oauth` | `authorization granted` | An MCP client got access; `via` is `password` or the sign-in provider's id. |
| `warn` | `oauth` | `refresh refused` | An MCP client's sign-in ended, so its refresh token no longer works; `reason` is `sign-in switched off` or `sign-in past its lifetime`. |
| `warn` | `auth` | `password login failed` | A wrong instance password on the login page (`"page":"login"`) or on an MCP client's authorize page (`"page":"authorize"`). Refusals for [too many attempts](configuration.md#rate-limits-and-caps) are not logged at this level. |
| `warn` | `limits` | `cap reached` | A post was refused by `NOTEFEED_MAX_FEEDS`, `NOTEFEED_MAX_NOTES_PER_FEED` or `NOTEFEED_MAX_IMAGES_PER_FEED`; `kind` is `feed`, `note` or `image`. |
| `warn`, `error` | `feeds` | a feed's read id or a leftover folder | A problem with a feed's files that notefeed works around, such as a `.readid` it can't read; the feed's name is never in it. |
| `error` | `http`, `mcp` | `request failed`, `tool failed` | An unexpected failure, answered with a bare `500` or `internal error`; `err` carries the error, with everything below the data directory in a path replaced by `<path>` (so no feed name or note title). |
| `error` | `http` | `an operation answered a status it doesn't declare` | A bug: an API operation answered a status its OpenAPI description doesn't list, and the client got a bare `500`; `operation` is the operation's id and `status` the status it tried to send. |
| `error` | `posting` | `a picture of a failed post could not be removed` | A post or an edit of a note with pictures failed while storing, and one of the picture notes it had already stored could not be removed again: that picture may be left in the feed (the removal also reports a file that was already gone) and can be deleted by hand. `note` is the picture note's id (its file in `DATA_DIR` starts with it), and `err` carries the error when the removal itself failed; the feed's name is never in it. |
| `debug` | `limits` | `rate limit reached` | A request over `NOTEFEED_RATE_LIMIT`; `kind` is `post` or `password`. |
| `debug` | `auth` | `password bearer refused` | A script sent a wrong instance password as its bearer token. |

What is never logged: note content, feed names (they work like passwords; a reserved feed's name, which you chose, is the one exception), passwords, tokens, secrets, authorization codes, `state` and `nonce` values, cookies, e-mail addresses, names and other claim values, the name an MCP client gave itself, client IP addresses, and request headers or bodies. There is no line per request: your reverse proxy's access log has that.

## Upgrading

With the published image:

```sh
docker compose pull && docker compose up -d
```

Image tags on `ghcr.io/marceltov/notefeed`:

| Tag | Moves on |
|---|---|
| `:latest` | every release and every change on `main` |
| `:main` | every change on `main` |
| `:X.Y.Z`, `:X.Y`, `:X` | releases (`:0.4` follows the newest 0.4.x) |

To upgrade only on purpose, pin a version, e.g. `image: ghcr.io/marceltov/notefeed:0.4`. Each release is listed on [GitHub Releases](https://github.com/Marceltov/notefeed/releases) with its notes.

Built from source:

```sh
git pull && docker compose up -d --build
```

Notes are untouched by upgrades.

### Upgrading from 0.3

0.4 replaces the single token-protected feed with named feeds:

- `NOTEFEED_TOKEN` is gone. Remove it; set `NOTEFEED_PASSWORD` if you want the instance locked.
- `POST /api/notes` is now `POST /<feed>`, and `/feed.xml` is now each feed's read link. Update scripts, and the [client libraries](clients.md#upgrading-from-03) to 0.4.
- Old notes sit directly in `DATA_DIR` and are ignored now. Move them into a feed:

    ```sh
    mkdir data/homelab-7f3k2q9x4m8wz
    mv data/*.md data/homelab-7f3k2q9x4m8wz/
    ```

## Running from source

For development:

```sh
npm ci
DATA_DIR=./data npm run dev
npm test && npm run lint && npm run typecheck
```
