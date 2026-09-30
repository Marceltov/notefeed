# notefeed

notefeed is a small self-hosted inbox for short markdown notes. You post notes to a named feed from scripts over HTTP, or by hand in a web UI, and read them back as RSS. Each note is a plain `.md` file on disk.

It exists because dashboards like [Glance](https://github.com/glanceapp/glance) and Dynacat can *read* RSS but have nowhere to *post* to. A backup job, a deploy script or a cron check can drop a note into notefeed, and it shows up on the dashboard a few minutes later.

![A notefeed feed page: a compose box, the feed's read link, and notes grouped by day](assets/screenshot-light.png#only-light)
![A notefeed feed page: a compose box, the feed's read link, and notes grouped by day](assets/screenshot-dark.png#only-dark)

## How feeds work

notefeed works like [ntfy](https://ntfy.sh): there are no accounts and nothing to set up. A feed is a name, such as `homelab-7f3k2`. Posting to `/<name>` creates the feed on its first note, and `/<name>` in a browser shows it.

Every feed also has a **read link**, `/r/<read id>/feed.xml`. It serves the feed as RSS, shows none of the feed's name, and can't post. That's the link to give to feed readers, dashboards and other people.

!!! warning "Pick a hard-to-guess name"
    The feed name is the key: anyone who knows it can read the feed and post to it. Use something like `homelab-7f3k2`, not `homelab`. Share read access with the [read link](feed.md), never the name.

To keep strangers from posting at all, set a password (`NOTEFEED_PASSWORD`); see [Configuration](configuration.md#the-password).

## Quick start

You need Docker with Compose. No checkout, no build: the image is published at `ghcr.io/marceltov/notefeed`.

**1. Create a folder with this `compose.yaml`:**

```yaml
services:
  notefeed:
    image: ghcr.io/marceltov/notefeed:latest  # or pin a release, e.g. :0.4
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      TZ: Europe/Berlin                         # time zone for the web UI
      # PUBLIC_URL: https://notes.example.com   # on a public instance, see Configuration
      # NOTEFEED_PASSWORD: ${NOTEFEED_PASSWORD} # optional: lock posting and the web UI
    volumes:
      - ./data:/data  # your notes, as plain .md files
```

**2. Create the data folder, then start it:**

```sh
mkdir data   # notefeed writes notes as the owner of this folder, so they're yours
docker compose up -d
```

Your notes are plain files in `data`, one folder per feed, owned by you: read them, grep them, or commit them to git (see [Operations](operations.md#keeping-notes-in-git)).

**3. Open <http://localhost:3000>**, pick a feed name (it suggests a random one), and write a note. Or post your first note from a shell:

```sh
curl --data-binary $'# Hello\nMy first note.' http://localhost:3000/homelab-7f3k2
```

The answer holds the feed's `read_url`. Add it to any feed reader.

## Where to go next

- [Posting notes](posting.md): the API, accepted formats, errors and script examples.
- [Client libraries](clients.md): Python and Node packages, and the `notefeed` command.
- [Web UI](web-ui.md): the start page, feed pages and writing notes by hand.
- [Read links and RSS](feed.md): hooking notefeed up to Glance, Dynacat and other readers.
- [Configuration](configuration.md): every setting, the password, rate limits and caps.
- [Reverse proxy](reverse-proxy.md): putting notefeed on the internet behind Caddy.
- [Operations](operations.md): feed folders, upgrades, backups and deleting notes.
