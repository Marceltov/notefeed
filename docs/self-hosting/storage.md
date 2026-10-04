# Storage

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

Every dot file in a feed's folder is the feed's or a note's metadata, and none is ever served or listed as a note. Three belong to the feed: `.readid` is its read link, `.feed.json` its title, description and title image, `.password` its [password](../using/feed-passwords.md#a-lost-password). They are plain files you can read and copy; don't edit `.readid` by hand, because the feed's read link changes with it. If you copy a feed's folder to make another feed, remove `.readid` from the copy: two feeds can't share a read link, and at the next start the folder whose name sorts first keeps it, which can be the copy, and the original's readers would then get the copy's notes. The other folder gets the read link computed from its name.

With the quick start's `compose.yaml` that's the `data` folder next to it. You can read, grep or copy the files directly.

notefeed writes them as the **owner of that folder**: create it yourself (`mkdir data`) and the notes are yours. To choose a different owner, set `PUID` and `PGID`. If Docker created the folder (owned by root), notefeed falls back to uid/gid 1000.

notefeed only reads folders with valid feed names and files named like notes. Anything else in `DATA_DIR`, such as `.git` or loose files, is ignored. So are symlinks, even to a folder: a feed must be a real folder inside `DATA_DIR`, so a link can't expose files from elsewhere on the disk.

## Databases

By default notefeed keeps everything as files, as described above. With `NOTEFEED_STORAGE` it can keep it in a database instead: `sqlite` (one file, no server) or `postgres` (a server, and several notefeed containers can share it). Nothing else changes: the API, the read links and the web UI are the same.

| | `fs` (default) | `sqlite` | `postgres` |
|---|---|---|---|
| Where | folders in `DATA_DIR` | one file, `NOTEFEED_DATABASE_URL` (default `DATA_DIR/notefeed.db`) | a PostgreSQL server (tested with 17), `NOTEFEED_DATABASE_URL` |
| `NOTEFEED_SECRET` | optional | required | required |
| Containers | one | one | several |
| Back up with | copy the folder | copy the file while notefeed is stopped, or `sqlite3 notefeed.db ".backup out.db"` | `pg_dump` |

Two tables hold it all: `feeds` (name, read id, password hash and settings) and `notes` (feed, id, extension, content, metadata). A picture is a note, so its bytes are in `notes.content`; there is no separate file store. The tables are created, and updated when notefeed is upgraded, when it starts. A database made by a newer notefeed is refused with a message saying so.

Things that differ from files:

- **No hand-editing.** Dropping a file into a folder, or removing one, is how you change a feed on `fs`; with a database you use the API or the web UI.
- **Moving between backends is not built in yet.** A new instance on a database starts empty. Moving an existing `data` folder into a database needs a script of your own.
- **The server secret is yours to set.** With no data folder there is nowhere to keep a generated one, so `NOTEFEED_SECRET` (at least 32 bytes, `openssl rand -hex 32`) is required, and the same value must be given to every container.

A PostgreSQL setup with Docker Compose is in [PostgreSQL](postgres.md#postgresql).

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
