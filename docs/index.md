# notefeed

notefeed is a small self-hosted inbox for short markdown notes. You post notes from scripts over HTTP, or by hand in a web UI, and read them back as an RSS feed. Each note is a plain `.md` file on disk.

It exists because dashboards like [Glance](https://github.com/glanceapp/glance) and Dynacat can *read* RSS but have nowhere to *post* to. A backup job, a deploy script or a cron check can drop a note into notefeed, and it shows up on the dashboard a few minutes later.

## Quick start

You need Docker with Compose.

```sh
git clone https://github.com/Marceltov/notefeed.git && cd notefeed
cp .env.example .env
# Set NOTEFEED_TOKEN in .env to a long random secret, e.g. from: openssl rand -hex 32
docker compose up -d
```

notefeed now runs on <http://localhost:3000>. Log in with the token, or post your first note from a shell:

```sh
export NOTEFEED_TOKEN=change-me   # the value from .env
curl -H "Authorization: Bearer $NOTEFEED_TOKEN" \
  --data-binary $'# Hello\nMy first note.' \
  http://localhost:3000/api/notes
```

The feed is at <http://localhost:3000/feed.xml>. Add it to any feed reader.

## Where to go next

- [Posting notes](posting.md): the API, accepted formats, errors and script examples.
- [Web UI](web-ui.md): writing notes by hand.
- [The feed](feed.md): hooking notefeed up to Glance, Dynacat and other readers.
- [Configuration](configuration.md): every setting.
- [Reverse proxy](reverse-proxy.md): putting notefeed on the internet behind Caddy.
- [Operations](operations.md): upgrades, backups and deleting notes.
