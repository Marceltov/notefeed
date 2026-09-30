# notefeed

Post short markdown notes — from a script over HTTP, or by hand in a small web UI — and read them back as an RSS feed. Each note is a plain `.md` file on disk. Built as an inbox for dashboards like Glance and Dynacat, which can read RSS but have nowhere to post to.

**Documentation: https://docs.notefeed.me/**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshot-dark.png">
  <img alt="The notefeed web UI: a compose box above notes grouped by day" src="docs/assets/screenshot-light.png">
</picture>

## Quick start

Save this as `compose.yaml`, then create the data folder and the token, and start it:

```yaml
services:
  notefeed:
    image: ghcr.io/marceltov/notefeed:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NOTEFEED_TOKEN: ${NOTEFEED_TOKEN:?Set NOTEFEED_TOKEN in .env}
    volumes:
      - ./data:/data
```

```sh
mkdir data   # notes are written as the owner of this folder
echo "NOTEFEED_TOKEN=$(openssl rand -hex 32)" > .env
docker compose up -d
```

Open http://localhost:3000 and log in with the token. Post from a script:

```sh
curl -H "Authorization: Bearer $NOTEFEED_TOKEN" --data-binary @note.md http://localhost:3000/api/notes
```

Or with a client: `pip install notefeed` / `npm install notefeed`, then `notefeed post "# Hello"`.

Read the feed at http://localhost:3000/feed.xml.

## License

- **The notefeed server** (the web app and the Docker image) is licensed under the [GNU Affero General Public License v3.0](LICENSE). You can self-host it for free, for yourself or your company. If you run a modified version as a service for others, you must publish your changes under the same license.
- **The client packages** (`packages/python`, `packages/js`) are licensed under the [Apache License 2.0](packages/js/LICENSE), so any app or script can use them.

Versions up to and including 0.2.x were released under the MIT License.
