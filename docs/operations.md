# Operations

## Where notes live

Every note is a plain markdown file in `DATA_DIR` (`/data` in the container), named `<id>.md`. With the quick start's `compose.yaml` that's the `notefeed-data` Docker volume, which Docker names `<folder>_notefeed-data` (`notefeed_notefeed-data` if the folder is called `notefeed`, as below). You can read, grep or copy the files directly.

## Backups

Back up the volume, or just the `.md` files. There's no database: restoring the files restores the notes.

```sh
docker run --rm -v notefeed_notefeed-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/notefeed-notes.tgz -C /data .
```

## Deleting a note

Delete its file. It disappears from the web UI and the feed straight away.

```sh
docker compose exec notefeed rm /data/20260929T140512Z-backup-finished.md
```

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
| `:X.Y.Z`, `:X.Y`, `:X` | releases (`:0.1` follows the newest 0.1.x) |

To upgrade only on purpose, pin a version, e.g. `image: ghcr.io/marceltov/notefeed:0.1`. Each release is listed on [GitHub Releases](https://github.com/Marceltov/notefeed/releases) with its notes.

Built from source:

```sh
git pull && docker compose up -d --build
```

Notes are untouched by upgrades.

## Running from source

For development:

```sh
npm ci
NOTEFEED_TOKEN=dev DATA_DIR=./data npm run dev
npm test && npm run lint && npm run typecheck
```
