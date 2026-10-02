# Operations

## Where notes live

Every feed is a folder in `DATA_DIR` (`/data` in the container), named after the feed, and every note is a plain markdown file in it, named `<id>.md`:

```
data/
├── .secret                                  # signs cookies and tokens, and is behind older feeds' read links; back it up
├── homelab-7f3k2q9x4m8wz/
│   ├── .readid                              # the feed's read id (feeds created since feed deletion was added; older ones have none)
│   ├── .feed.json                           # title and description, if set
│   ├── .password                            # only on a protected feed
│   ├── .images/                             # uploaded images, only once one was uploaded
│   │   └── 3b1f0c9d5a7e42c8b6d1e0f4a9c27d58.png
│   ├── 20260929T140512Z-backup-finished.md
│   └── 20260930T081500Z-deploy-done.md
└── alerts-q9x2m7hd4k1pv/
    └── 20260930T090210Z-disk-space-low.md
```

The three dot files in a feed's folder are part of the feed. `.readid` is its read link, `.feed.json` its title, description and title image, `.password` its [password](#a-lost-feed-password). They are plain files you can read and copy; don't edit `.readid` by hand, because the feed's read link changes with it. If you copy a feed's folder to make another feed, remove `.readid` from the copy: two feeds can't share a read link, and at the next start the folder whose name sorts first keeps it, which can be the copy, and the original's readers would then get the copy's notes. The other folder gets the read link computed from its name.

With the quick start's `compose.yaml` that's the `data` folder next to it. You can read, grep or copy the files directly.

notefeed writes them as the **owner of that folder**: create it yourself (`mkdir data`) and the notes are yours. To choose a different owner, set `PUID` and `PGID`. If Docker created the folder (owned by root), notefeed falls back to uid/gid 1000.

notefeed only reads folders with valid feed names and files named like notes. Anything else in `DATA_DIR`, such as `.git` or loose files, is ignored. So are symlinks, even to a folder: a feed must be a real folder inside `DATA_DIR`, so a link can't expose files from elsewhere on the disk.

## Images

Uploaded images are in `.images/` inside the feed's folder, each named by the first 32 characters of its SHA-256 hash and an extension (`png`, `jpg`, `gif` or `webp`), and stored exactly as uploaded. Back them up with the rest of `data`: they are in the feed's folder, so a `tar` of `data` includes them, but a tool that skips hidden folders does not. A note that links to an image that was lost shows a broken image.

Two things to know:

- **Metadata stays.** notefeed does not resize, re-encode or clean images, so EXIF data in a photo, including GPS position, camera and time, is in the stored file and in what readers download. The image is public to anyone with the feed's read link, so strip metadata before uploading if the photo is sensitive. For example, `exiftool -all= photo.jpg` removes it.
- **Images are not removed with notes.** Deleting a note leaves its images, because another note may use them, and notefeed has no endpoint to list or delete one image. They go when the feed is [deleted](#deleting-notes-and-feeds). To remove one image sooner, delete its file; the image then answers `404`, and notes that link to it show a broken image. If it was the feed's title image, remove the title image in the feed settings first.

```sh
ls -l data/homelab-7f3k2q9x4m8wz/.images/
rm data/homelab-7f3k2q9x4m8wz/.images/3b1f0c9d5a7e42c8b6d1e0f4a9c27d58.png
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

Back up the `data` folder, including `.secret` and the dot files and the `.images` folder inside each feed folder: `.readid`, `.feed.json`, `.password` and `.images/`. There's no database: restoring the files restores the notes, the settings and the passwords. A backup that skips hidden files (a plain `cp *`, or a tool with a default exclude) loses them: a feed without its `.readid` gets the read link computed from its name and `.secret` instead, which is a different link for any feed created since feed deletion was added, and a feed without its `.password` is open. Restoring `.secret` keeps the read links of older feeds the same, and unlocked browsers and MCP clients signed in (unless `NOTEFEED_SECRET` is set, which then decides both). Restart notefeed after restoring: it reads the list of feeds once at startup, so the read links of restored feeds only work after a restart.

```sh
tar czf notefeed-notes.tgz -C data .
```

## Deleting notes and feeds

A feed's owner can delete it from the web UI or the [API](posting.md#feed-settings-and-deleting-a-feed). That removes the notes, the uploaded images, the settings, the password and the read link, frees the name, and takes the feed out of the `NOTEFEED_MAX_FEEDS` count at once. notefeed first renames the folder to `.deleted-<random>` in `DATA_DIR` and then removes it; if it stops in between, the leftover folder is removed at the next start. A new feed's folder is likewise made as `.<random>.tmp` and renamed into place, and one left by a crash is removed at the next start too.

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
