# PostgreSQL

To keep feeds and notes in PostgreSQL instead of files, set `NOTEFEED_STORAGE=postgres`, give notefeed the database in `NOTEFEED_DATABASE_URL` and a `NOTEFEED_SECRET`. This page is a Docker Compose setup with both containers. [Storage](storage.md#databases) says what changes compared with files.

```yaml
# compose.yaml
services:
  notefeed:
    image: ghcr.io/notefeed/notefeed:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NOTEFEED_STORAGE: postgres
      NOTEFEED_DATABASE_URL: postgres://notefeed:${POSTGRES_PASSWORD}@db:5432/notefeed
      NOTEFEED_SECRET: ${NOTEFEED_SECRET}      # openssl rand -hex 32
      # PUBLIC_URL: https://notes.example.com
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: notefeed
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: notefeed
    volumes:
      - notefeed-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U notefeed"]
      interval: 5s
      retries: 10

volumes:
  notefeed-db:
```

Put `POSTGRES_PASSWORD` and `NOTEFEED_SECRET` in a `.env` file next to it (`openssl rand -hex 32` for each), then `docker compose up -d`. notefeed creates its tables when it starts; there is nothing to set up by hand. It needs no `data` folder, so the compose file has no volume for it.

- **Several containers** can use the same database. Give each the same `NOTEFEED_SECRET`, or cookies and tokens made by one are refused by another.
- **A password in the URL** with characters like `@` or `/` must be percent-encoded (`%40`, `%2F`).
- **A wrong URL or password** makes requests fail with `cannot use the database named by NOTEFEED_DATABASE_URL` and an error code in brackets (such as `ECONNREFUSED` or `28P01`); the URL itself is never part of the message.
- **Back up** with `docker compose exec db pg_dump -U notefeed notefeed > notefeed.sql`, and keep `NOTEFEED_SECRET` with it.
