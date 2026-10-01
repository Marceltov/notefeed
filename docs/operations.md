# Operations

## Where notes live

Every feed is a folder in `DATA_DIR` (`/data` in the container), named after the feed, and every note is a plain markdown file in it, named `<id>.md`:

```
data/
├── .secret                                  # behind older feeds' read links; back it up
├── homelab-7f3k2q9x4m8wz/
│   ├── .readid                              # the feed's read id (feeds created since feed deletion was added; older ones have none)
│   ├── .feed.json                           # title and description, if set
│   ├── .password                            # only on a protected feed
│   ├── 20260929T140512Z-backup-finished.md
│   └── 20260930T081500Z-deploy-done.md
└── alerts-q9x2m7hd4k1pv/
    └── 20260930T090210Z-disk-space-low.md
```

The three dot files in a feed's folder are part of the feed. `.readid` is its read link, `.feed.json` its title and description, `.password` its [password](#a-lost-feed-password). They are plain files you can read and copy; don't edit `.readid` by hand, because the feed's read link changes with it.

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

Leave `.secret` out if the repository goes anywhere public (`echo .secret > .gitignore`): with it, anyone can compute the read link of every feed that has no `.readid`. Keep the dot files inside the feed folders, and `.readid` in particular, out of a public repository too: `.readid` is the feed's read link, and `.password` is its password hash. They go into the repository with `git add -A`, so ignore them if the repository is public.

## Backups

Back up the `data` folder, including `.secret` and the dot files inside each feed folder: `.readid`, `.feed.json` and `.password`. There's no database: restoring the files restores the notes, the settings and the passwords. A backup that skips hidden files (a plain `cp *`, or a tool with a default exclude) loses them: a feed without its `.readid` gets the read link computed from its name and `.secret` instead, which is a different link for any feed created since feed deletion was added, and a feed without its `.password` is open. Restoring `.secret` keeps the read links of older feeds the same (unless `NOTEFEED_SECRET` is set, which then decides them). Restart notefeed after restoring: it reads the list of feeds once at startup, so the read links of restored feeds only work after a restart.

```sh
tar czf notefeed-notes.tgz -C data .
```

## Deleting notes and feeds

A feed's owner can delete it from the web UI or the [API](posting.md#feed-settings-and-deleting-a-feed). That removes the notes, the settings, the password and the read link, frees the name, and takes the feed out of the `NOTEFEED_MAX_FEEDS` count at once. notefeed first renames the folder to `.deleted-<random>` in `DATA_DIR` and then removes it; if it stops in between, the leftover folder is removed at the next start.

You can also delete a note's file, or a feed's whole folder, yourself. It disappears from the web UI and the feed straight away, but a feed you removed by hand still counts toward `NOTEFEED_MAX_FEEDS` until notefeed restarts.

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

If a feed's first note fails to save (a full disk, say), notefeed may leave an empty feed folder with its `.readid`. That is an existing, open feed with no notes: it counts toward `NOTEFEED_MAX_FEEDS`, and it cannot be given a password, because a password can only be set when a feed is created. Delete the feed (with `DELETE /api/v1/feeds/<feed>`, or by removing the folder) and create it again.

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
