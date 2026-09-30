# Configuration

notefeed is configured with environment variables. With Compose, set them under `environment:` in `compose.yaml`, or in `.env` next to it and reference them there. None is required: with none set, notefeed runs as an open instance.

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | derived from the request | Absolute base URL used for links in the feed and API responses, e.g. `https://notes.example.com`. Set it on a public instance, see [below](#public_url). |
| `NOTEFEED_PASSWORD` | none: open instance | Instance password. When set, posting needs it as a bearer token and the web UI needs a login. Read links stay open. See [The password](#the-password). |
| `NOTEFEED_TRUST_PROXY` | off | Set to `1` behind a reverse proxy, so rate limits apply per client IP from `X-Forwarded-For`. See [Rate limits and caps](#rate-limits-and-caps). |
| `NOTEFEED_RATE_LIMIT` | `60` | Posts per client per minute, and separately wrong passwords per client per minute. `0` turns the limit off. |
| `NOTEFEED_MAX_FEEDS` | `0`: no limit | Most feeds on the instance. Posting to a new feed beyond it answers `507`. |
| `NOTEFEED_MAX_NOTES_PER_FEED` | `0`: no limit | Most notes in one feed. Posting beyond it answers `507`. |
| `NOTEFEED_SECRET` | random, kept in `DATA_DIR/.secret` | Secret the [read links](feed.md) are derived from. Changing it changes every read link. |
| `NOTEFEED_TITLE` | `notefeed` | Title of the RSS feed and of the read-only view. |
| `DATA_DIR` | `/data` | Folder holding the feeds, one subfolder each. |
| `TZ` | `UTC` | Time zone for the times shown in the web UI, e.g. `Europe/Berlin`. |
| `PUID`, `PGID` | owner of `DATA_DIR` | User and group notefeed runs as, and so the owner of new note files. By default the owner of the data folder; uid/gid 1000 if that is root. Docker image only. |

An empty value counts as unset.

## Open or locked

Without a password, notefeed works like [ntfy](https://ntfy.sh): anyone who can reach it can post to any feed whose name they know, and read it. Feed names are the only secret, so pick hard-to-guess ones. That's fine on a LAN, or on the internet with the caps below.

!!! warning "Share the read link, never the feed name"
    Anyone who knows a feed's name can read and post to it. Give readers and dashboards the [read link](feed.md) instead.

## The password

Set `NOTEFEED_PASSWORD` to lock the instance: posting then needs `Authorization: Bearer <password>`, and every page except the login page and the read-only views needs a login. Read links keep working without it, so feed readers need no change. Generate a long random password:

```sh
openssl rand -hex 32
```

There is one password for the whole instance. Changing it logs out every browser and breaks every script until you update them. Wrong passwords, over the API or on the login page, are rate-limited like posts.

## Rate limits and caps

Each client may post `NOTEFEED_RATE_LIMIT` notes per minute (60 by default), from the API and the web UI together. Wrong passwords have their own budget of the same size. Over it, notefeed answers `429` with a `Retry-After` header, for the rest of the minute. The counters live in memory and reset on restart.

!!! warning "Behind a reverse proxy, set `NOTEFEED_TRUST_PROXY=1`"
    notefeed can't see a client's IP on its own, so without `NOTEFEED_TRUST_PROXY` **all clients share one rate-limit bucket**. On an exposed instance, one busy script can then slow everyone down, and an attacker's wrong password guesses can lock the owner out of posting and logging in for up to a minute.

    With `NOTEFEED_TRUST_PROXY=1`, the first address in `X-Forwarded-For` is the client. Set it only behind a proxy that **overwrites** `X-Forwarded-For` with the real client address, and never appends to one the client sent: otherwise clients can pick their own bucket. Caddy does this by default; see [Reverse proxy](reverse-proxy.md).

On a public open instance, cap how much space strangers can take:

```yaml
environment:
  NOTEFEED_MAX_FEEDS: 100
  NOTEFEED_MAX_NOTES_PER_FEED: 1000
```

Over a cap, posting answers `507`. The caps are checked, not locked, so several posts at the same moment can overshoot by a few. Delete notes or feeds to make room (see [Operations](operations.md#deleting-notes-and-feeds)).

## `PUBLIC_URL`

When `PUBLIC_URL` is unset, notefeed builds links from `X-Forwarded-Proto` and `X-Forwarded-Host` from a reverse proxy, and falls back to the `Host` header.

!!! warning "Set `PUBLIC_URL` on a public instance"
    Otherwise the links in the RSS feed and in API responses follow whatever `Host` header the client sent.

Also set it when feed readers reach notefeed by a different address than people do, for example over the LAN.
