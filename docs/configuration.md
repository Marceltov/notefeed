# Configuration

notefeed is configured with environment variables. With Compose, put them in `.env` next to `compose.yaml`.

| Variable | Default | Meaning |
|---|---|---|
| `NOTEFEED_TOKEN` | none, required | Shared secret for the API and the web UI login. notefeed won't start without it. |
| `DATA_DIR` | `/data` | Folder holding the `.md` files. |
| `PUBLIC_URL` | derived from the request | Absolute base URL used for links in the feed and API responses, e.g. `https://notes.example.com`. |
| `NOTEFEED_TITLE` | `notefeed` | The feed's title. |
| `TZ` | `UTC` | Time zone for the times shown in the web UI, e.g. `Europe/Berlin`. |

An empty value counts as unset.

## The token

Generate a long random token:

```sh
openssl rand -hex 32
```

!!! warning "Keep the token secret"
    Anyone with the token can post notes and read them in the web UI. Changing it logs out every browser and breaks every script until you update them.

## How `PUBLIC_URL` is derived

When `PUBLIC_URL` is unset, notefeed uses `X-Forwarded-Proto` and `X-Forwarded-Host` from a reverse proxy, and falls back to the `Host` header. Set it explicitly when feed readers reach notefeed by a different address than people do, for example over the LAN.
