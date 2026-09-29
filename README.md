# notefeed

Post short markdown notes — from a script over HTTP, or by hand in a small web UI — and read them back as an RSS feed. Each note is a plain `.md` file on disk.

Built as an inbox for dashboards like Glance that can read RSS but have nowhere to post to.

## Run it

```sh
cp .env.example .env        # then set NOTEFEED_TOKEN to a long random secret
docker compose up -d
```

Open http://localhost:3000 and log in with the token. Notes live in the `notefeed-data` volume.

Without Compose:

```sh
docker run -d -p 3000:3000 -e NOTEFEED_TOKEN=... -v notefeed-data:/data ghcr.io/marceltov/notefeed:latest
```

## Post a note

```sh
curl -H "Authorization: Bearer $NOTEFEED_TOKEN" --data-binary @note.md http://localhost:3000/api/notes
```

The body is stored as-is. `text/markdown`, `text/plain`, curl's default form type, or JSON `{"markdown": "..."}` all work. The response is `201 {"id": "...", "url": "..."}`. The title is the first `# ` heading, or else the first line.

## Read the feed

`http://localhost:3000/feed.xml` — RSS 2.0, newest 50 notes, no login needed.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `NOTEFEED_TOKEN` | — (required) | Shared secret for the API and UI login |
| `DATA_DIR` | `/data` | Where `.md` files live |
| `PUBLIC_URL` | derived from the request (`X-Forwarded-Proto`/`X-Forwarded-Host`, else `Host`) | Absolute base URL for feed links |
| `NOTEFEED_TITLE` | `notefeed` | Feed title |
| `TZ` | `UTC` | Time zone for times in the UI |

## Exposing it

Putting it on the internet behind a reverse proxy is fine: auth is built in. The UI and API need the token; only `/feed.xml` and `/login` are public. Set `PUBLIC_URL`, or have the proxy forward `X-Forwarded-Proto` and `X-Forwarded-Host`, so feed links point at the public address. Changing `NOTEFEED_TOKEN` logs everyone out.

## Develop

```sh
npm ci
NOTEFEED_TOKEN=dev DATA_DIR=./data npm run dev
npm test && npm run lint && npm run typecheck
```

## License

MIT
