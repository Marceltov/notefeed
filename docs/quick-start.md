# Quick start

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
curl -H "Content-Type: text/markdown" --data-binary $'# Hello\nMy first note.' http://localhost:3000/homelab-7f3k2q9x4m8wz
```

The answer holds the feed's `read_url`. Add it to any feed reader.
