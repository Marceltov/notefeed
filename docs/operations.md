# Operations

## Where notes live

Every feed is a folder in `DATA_DIR` (`/data` in the container), named after the feed, and every note is a plain markdown file in it, named `<id>.md`:

```
data/
├── .secret                                  # behind the read links; back it up
├── homelab-7f3k2q9x4m8wz/
│   ├── 20260929T140512Z-backup-finished.md
│   └── 20260930T081500Z-deploy-done.md
└── alerts-q9x2m7hd4k1pv/
    └── 20260930T090210Z-disk-space-low.md
```

With the quick start's `compose.yaml` that's the `data` folder next to it. You can read, grep or copy the files directly.

notefeed writes them as the **owner of that folder**: create it yourself (`mkdir data`) and the notes are yours. To choose a different owner, set `PUID` and `PGID`. If Docker created the folder (owned by root), notefeed falls back to uid/gid 1000.

notefeed only reads folders with valid feed names and files named like notes. Anything else in `DATA_DIR`, such as `.git` or loose files, is ignored. So are symlinks, even to a folder: a feed must be a real folder inside `DATA_DIR`, so a link can't expose files from elsewhere on the disk.

## Keeping notes in git

Since the notes are your files, `data` can be a git repository:

```sh
cd data
git init
git add -A && git commit -m "notes"
```

Leave `.secret` out if the repository goes anywhere public (`echo .secret > .gitignore`): with it, anyone can compute every feed's read link.

## Backups

Back up the `data` folder, including `.secret`. There's no database: restoring the files restores the notes, and restoring `.secret` keeps the read links the same (unless `NOTEFEED_SECRET` is set, which then decides them). Restart notefeed after restoring: it reads the list of feeds once at startup, so the read links of restored feeds only work after a restart.

```sh
tar czf notefeed-notes.tgz -C data .
```

## Deleting notes and feeds

Delete a note's file, or a feed's whole folder. It disappears from the web UI and the feed straight away. A deleted feed still counts toward `NOTEFEED_MAX_FEEDS` until notefeed restarts.

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
