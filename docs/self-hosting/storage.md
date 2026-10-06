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

Two tables hold it all: `feeds` (name, read id, password hash and settings) and `notes` (feed, id, extension, content, metadata). An image is a note, so its bytes are in `notes.content`, unless you [move image bytes out of the database](#image-bytes-outside-the-database). The tables are created, and updated when notefeed is upgraded, when it starts. A database made by a newer notefeed is refused with a message saying so.

Things that differ from files:

- **No hand-editing.** Dropping a file into a folder, or removing one, is how you change a feed on `fs`; with a database you use the API or the web UI.
- **Moving between backends is not built in yet.** A new instance on a database starts empty. Moving an existing `data` folder into a database needs a script of your own.
- **The server secret is yours to set.** With no data folder there is nowhere to keep a generated one, so `NOTEFEED_SECRET` (at least 32 bytes, `openssl rand -hex 32`) is required, and the same value must be given to every container.

`sqlite` and `postgres` need Node 22 or later when you run from source (the Docker image has it); `fs` runs on any Node version notefeed supports.

A PostgreSQL setup with Docker Compose is in [PostgreSQL](postgres.md#postgresql).

## Which setup for which instance

| Instance | Feeds and notes | Image bytes |
|---|---|---|
| One container for yourself or a small group | `fs` (default) or `sqlite` | with the notes |
| One container plus PostgreSQL | `postgres` | in the database, or in a folder (`NOTEFEED_IMAGES=fs`) if there are many |
| Several containers behind a load balancer | `postgres` | an S3-compatible object store (`NOTEFEED_IMAGES=s3`) |

Feeds, text notes and metadata stay small on any instance. Image bytes are what grows, so they are what can be moved out.

## Image bytes outside the database

With `sqlite` or `postgres`, `NOTEFEED_IMAGES` says where the bytes of image notes go. Everything else about an image (its id, metadata, size and feed) stays in the database, and text notes always stay there too. Nothing changes for readers: images are still served by notefeed under the feed's read link, never straight from the folder or the bucket.

| `NOTEFEED_IMAGES` | Where the bytes are | Use it when |
|---|---|---|
| `db` (default) | in the note's row | the instance is small; one thing to back up |
| `fs` | one file per image in `NOTEFEED_IMAGES_DIR` (default `DATA_DIR/images`) | one container with many images, and you want a small database |
| `s3` | one object per image in a bucket of an S3-compatible store | several containers, which must all reach every image |

The setting is for the database backends only. With `NOTEFEED_STORAGE=fs` images are files in the feed's folder, and `NOTEFEED_IMAGES=fs` or `s3` stops notefeed from starting.

### An S3-compatible object store

Any store that speaks the S3 protocol works: a hosted one (Hetzner Object Storage, IONOS, OVHcloud, Scaleway, Cloudflare R2, AWS S3) or one you run (MinIO, Garage). notefeed only puts, gets and deletes single objects, addressed as `<endpoint>/<bucket>/<object>`, so nothing provider-specific is needed. Create the bucket yourself, keep it private, and give notefeed a key that may read, write and delete objects in it.

```yaml
services:
  notefeed:
    image: ghcr.io/notefeed/notefeed:latest
    environment:
      NOTEFEED_STORAGE: postgres
      NOTEFEED_DATABASE_URL: postgres://notefeed:change-me@db:5432/notefeed
      NOTEFEED_SECRET: <openssl rand -hex 32>
      NOTEFEED_IMAGES: s3
      NOTEFEED_S3_ENDPOINT: https://s3.example.com
      NOTEFEED_S3_BUCKET: notefeed-images
      NOTEFEED_S3_REGION: us-east-1        # what your store calls its region; many accept us-east-1
      NOTEFEED_S3_ACCESS_KEY: <access key>
      NOTEFEED_S3_SECRET_KEY: <secret key>
```

There is no default endpoint. notefeed refuses to start unless the endpoint, the bucket and both keys are set, and it never logs any of them. Objects are named by a random key, so the bucket shows neither feed names nor note ids.

How available your images are is up to the store. If it is unreachable, images fail to load and posting an image answers with an error; text notes, the feed pages and RSS keep working.

### Things to know

- **Changing the setting.** Going from `db` to `fs` or `s3` works at any time: images already in the database stay there and are still served, new ones go out. Going between `fs` and `s3`, or back to `db`, is not supported: notefeed does not move images, and those already moved out would show as broken until you switch back.
- **Unreferenced files.** The image is written first and its note second, and a note is deleted before its image. If notefeed is stopped between the two steps, or the store fails to delete, a file or object is left that no note refers to. It cannot be reached by anyone and only takes up space. [Cleaning up the image store](#cleaning-up-the-image-store) finds and removes them.
- **One folder or bucket per instance.** The clean-up removes every image-named file or object that this instance's database does not know. Two instances sharing one bucket would delete each other's images.
- **A missing file or object** shows as a broken image; the note is still listed and can be deleted.
- **Backups** are the database plus the folder or the bucket. See [Backups](backups.md).

### Cleaning up the image store

Set `NOTEFEED_OPERATOR_TOKEN` (at least 32 characters, `openssl rand -hex 32`) to turn on the operator's endpoint. Without it the endpoint answers `404`.

```sh
# What is there that no note refers to? Nothing is changed.
curl -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" https://notes.example.com/api/operator/images/unreferenced

# The same, and those files or objects are removed.
curl -X DELETE -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" https://notes.example.com/api/operator/images/unreferenced
```

```json
{ "store": "s3", "unreferenced": { "count": 3, "bytes": 482113 }, "deleted": { "count": 3, "bytes": 482113 }, "failed": 0, "too_recent": 1, "missing": 0 }
```

| Field | Meaning |
|---|---|
| `unreferenced` | Files or objects, older than an hour, that no note refers to |
| `deleted`, `failed` | Only on `DELETE`: how many of them were removed, and how many the store refused to remove (see the log) |
| `too_recent` | Written within the last hour and so left alone: an image being posted right now has its object before its note |
| `missing` | Image notes whose file or object is not in the store. They show as broken images; nothing is changed about them |

Things to know:

- It reads the whole folder or bucket listing and every image note's key, so on a large store it takes a while. It is meant for an occasional run, not for every minute.
- Only names that look like notefeed's image keys (32 hexadecimal characters) are ever counted or removed. Anything else in the folder or bucket is left alone.
- With `NOTEFEED_IMAGES=db`, or on the file system backend, there is no image store and the endpoint answers `409`. On the file system backend an image is the note's own file, so nothing can be left unreferenced.
- Wrong tokens are limited per address like wrong passwords.
- With [metrics](metrics.md) on, each run updates `notefeed_images_unreferenced`, `notefeed_images_unreferenced_bytes`, `notefeed_images_missing` and `notefeed_images_checked_timestamp_seconds`. They say what the last run found (after a `DELETE`, what it left), and are absent until the first run. A daily report keeps them current:

    ```sh
    0 4 * * * curl -fsS -H "Authorization: Bearer <token>" https://notes.example.com/api/operator/images/unreferenced >/dev/null
    ```

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
