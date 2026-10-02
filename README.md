# notefeed

Post short markdown notes to a named feed — from a script over HTTP, or by hand in a small web UI — and read them back as RSS. Like [ntfy](https://ntfy.sh), but for notes: there are no accounts, a feed is just a name, and each note is a plain `.md` file on disk. Built as an inbox for dashboards like Glance and Dynacat, which can read RSS but have nowhere to post to.

**Documentation: https://docs.notefeed.me/**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshot-dark.png">
  <img alt="A notefeed feed page: a compose box, the feed's read link, and notes grouped by day" src="docs/assets/screenshot-light.png">
</picture>

## Quick start

Save this as `compose.yaml`, create the data folder, and start it:

```yaml
services:
  notefeed:
    image: ghcr.io/marceltov/notefeed:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
```

```sh
mkdir data   # notes are written as the owner of this folder
docker compose up -d
```

Open http://localhost:3000 and pick a feed name. Anyone who knows the name can read and post to that feed, so make it hard to guess. Post from a script:

```sh
curl --data-binary @note.md http://localhost:3000/homelab-7f3k2q9x4m8wz
```

Or with a client: `pip install notefeed` / `npm install notefeed`, then `notefeed post "# Hello" --feed homelab-7f3k2q9x4m8wz`.

The answer includes the feed's `read_url`: a read-only RSS link to give to feed readers and dashboards. It doesn't reveal the feed name, and it can't post.

To require a password for posting and the web UI, set `NOTEFEED_PASSWORD`. Read links stay open. See [Configuration](https://docs.notefeed.me/configuration/). To protect a single feed, create it with `curl -H "X-Feed-Password: ..."`; see [Posting notes](https://docs.notefeed.me/posting/#a-feed-with-its-own-password).

Posted notes can be edited and deleted from the web UI, the API, the clients and MCP; see [Editing and deleting notes](https://docs.notefeed.me/posting/#editing-and-deleting-notes). AI assistants can post, read, edit and delete notes over MCP at `/mcp`; see [MCP](https://docs.notefeed.me/mcp/).

## Development

```sh
npm ci
npm run dev        # http://localhost:3000
npm test           # unit tests; npm run test:e2e for the browser tests
npm run generate   # after changing the API in backend/http/api.ts
```

The REST API is defined in code (`backend/http/api.ts`). `npm run generate` writes `openapi.json` from it, and from that the JS clients (`packages/js/src/generated/`, `app/_lib/api/`) and the Python client (`packages/python/src/notefeed/_generated/`). All of it is committed; CI fails when anything is stale. Generating needs Node 22.18 or newer (`.nvmrc`) and [uv](https://docs.astral.sh/uv/). The client packages: `cd packages/js && npm test`, `cd packages/python && uv run --extra test pytest`.

## License

- **The notefeed server** (the web app and the Docker image) is licensed under the [GNU Affero General Public License v3.0](LICENSE). You can self-host it for free, for yourself or your company. If you run a modified version as a service for others, you must publish your changes under the same license.
- **The client packages** (`packages/python`, `packages/js`) are licensed under the [Apache License 2.0](packages/js/LICENSE), so any app or script can use them.

Versions up to and including 0.2.x were released under the MIT License.
