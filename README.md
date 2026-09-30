# notefeed

Post short markdown notes — from a script over HTTP, or by hand in a small web UI — and read them back as an RSS feed. Each note is a plain `.md` file on disk. Built as an inbox for dashboards like Glance and Dynacat, which can read RSS but have nowhere to post to.

**Documentation: https://marceltov.github.io/notefeed/**

## Quick start

Save this as `compose.yaml`, then run `echo "NOTEFEED_TOKEN=$(openssl rand -hex 32)" > .env && docker compose up -d`:

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
      - notefeed-data:/data

volumes:
  notefeed-data:
```

Open http://localhost:3000 and log in with the token. Post from a script:

```sh
curl -H "Authorization: Bearer $NOTEFEED_TOKEN" --data-binary @note.md http://localhost:3000/api/notes
```

Or with a client: `pip install notefeed` / `npm install notefeed`, then `notefeed post "# Hello"`.

Read the feed at http://localhost:3000/feed.xml.

## License

MIT
