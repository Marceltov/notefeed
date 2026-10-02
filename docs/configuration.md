# Configuration

notefeed is configured with environment variables. With Compose, set them under `environment:` in `compose.yaml`, or in `.env` next to it and reference them there. None is required: with none set, notefeed runs as an open instance.

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | derived from the request | Absolute base URL used for links in the feed and API responses, e.g. `https://notes.example.com`. Set it on a public instance, see [below](#public_url). |
| `NOTEFEED_PASSWORD` | none: open instance | Instance password. When set, posting needs it as a bearer token and the web UI needs a login. Read links stay open. See [The password](#the-password). |
| `NOTEFEED_TRUST_PROXY` | off | Set to `1` behind a reverse proxy, so rate limits apply per client IP from `X-Forwarded-For`, and links without `PUBLIC_URL` follow `X-Forwarded-Proto` and `X-Forwarded-Host`. See [Rate limits and caps](#rate-limits-and-caps). |
| `NOTEFEED_RATE_LIMIT` | `60` | Posts, edits and deletes per client per minute, and separately wrong passwords per client per minute. `0` or less turns the limit off. |
| `NOTEFEED_MAX_FEEDS` | `0`: no limit (so is any value below 1) | Most feeds on the instance. Posting to a new feed beyond it answers `507`. |
| `NOTEFEED_RESERVED_FEEDS` | empty | Comma-separated feed names that can't be created, e.g. `news,announcements,updates`, in addition to notefeed's own route names. Posting to one answers `400` (`reserved_feed`). A feed that already has such a name keeps working. |
| `NOTEFEED_RESERVED_PASSWORD` | none | Password of the reserved feeds. When set, each reserved name (from `NOTEFEED_RESERVED_FEEDS`) exists from start-up as a [protected feed](posting.md#a-feed-with-its-own-password) with this password and its own name as read id (`/r/news`, `/r/news/feed.xml`), so only the operator can post to `news` while anyone can subscribe at a link that never changes. Without it, reserved names don't exist. It is only applied when a feed is created: change it later in the feed's settings. |
| `NOTEFEED_MAX_NOTES_PER_FEED` | `0`: no limit (so is any value below 1) | Most notes in one feed. Posting beyond it answers `507`. |
| `NOTEFEED_MAX_IMAGE_BYTES` | `5242880` (5 MiB) | Largest uploaded image, in bytes, at most 10 MiB (`10485760`; a larger value counts as that). Beyond it, the upload answers `413`. |
| `NOTEFEED_MAX_IMAGES_PER_FEED` | `0`: no limit (so is any value below 1) | Most images in one feed. A new image beyond it answers `507`. |
| `NOTEFEED_SECRET` | random, kept in `DATA_DIR/.secret` | The server secret, at least 32 characters (`openssl rand -hex 32`); notefeed refuses a shorter one, or a `.secret` file shorter than 32 bytes. It signs the unlock cookies of [protected feeds](posting.md#a-feed-with-its-own-password) and the [OAuth](#oauth) tokens of MCP clients, and the [read links](feed.md) of feeds created before feed deletion was added are derived from it. Changing it locks unlocked browsers again, signs MCP clients out and changes the read link of each of those older feeds; feeds created since have a stored read id and keep theirs. |
| `NOTEFEED_TITLE` | `notefeed` | Title of the RSS feed and of the read-only view, for a feed that has no title of its own. |
| `DATA_DIR` | `/data` | Folder holding the feeds, one subfolder each. |
| `TZ` | `UTC` | Time zone for the times shown in the web UI, e.g. `Europe/Berlin`. |
| `PUID`, `PGID` | owner of `DATA_DIR` | User and group notefeed runs as, and so the owner of new note files. By default the owner of the data folder; uid/gid 1000 if that is root. Docker image only. |

An empty value counts as unset.

## Open or locked

Without a password, notefeed works like [ntfy](https://ntfy.sh): anyone who can reach it can post to any feed whose name they know, and read it. Feed names are the only secret, so pick hard-to-guess ones. That's fine on a LAN, or on the internet with the caps below.

!!! warning "Share the read link, never the feed name"
    Anyone who knows a feed's name can read and post to it. Give readers and dashboards the [read link](feed.md) instead.

## The password

Set `NOTEFEED_PASSWORD` to lock the instance: posting then needs `Authorization: Bearer <password>`, and every page except the login page, the read-only views and the app icons, web manifest and share image needs a login. Read links keep working without it, so feed readers need no change. Generate a long random password:

```sh
openssl rand -hex 32
```

There is one password for the whole instance. Changing it logs out every browser and breaks every script until you update them. Wrong passwords, over the API or on the login page, are rate-limited like posts.

!!! note "Logins don't expire"
    The login cookie is derived from the password alone and stays valid for a year. Logging out only removes it from that browser: a copied cookie keeps working until the password changes. If you think a cookie leaked, change `NOTEFEED_PASSWORD`.

## Feed passwords

Besides the instance password, a single feed can have its own, set by whoever creates the feed: see [A feed with its own password](posting.md#a-feed-with-its-own-password). It needs no setting. The two work together: on a locked instance a protected feed needs `Authorization: Bearer <instance password>` and `X-Feed-Password`. The instance password does not open a protected feed. Read links stay open either way.

Each feed's password is stored as a salted scrypt hash in `DATA_DIR/<feed>/.password`. If a password is lost, delete that file: the feed is open from the next request. See [Operations](operations.md#a-lost-feed-password). Wrong feed passwords count toward the same [failed-attempt limit](#rate-limits-and-caps) as the instance password. A request that sends no feed password at all is refused without being counted, so strangers who merely open a protected feed can't lock its owner out.

## OAuth

Clients that can't send a header, such as the Claude.ai and Claude Desktop connectors for [MCP](mcp.md), log in through notefeed's own OAuth 2.1 login page with the instance password. It only exists on an instance with a password; on an open one these endpoints answer `404`.

- **`PUBLIC_URL` is the issuer.** Every OAuth URL is built from it, so set it, with `https://`, on an instance that connectors reach over the internet.
- **Nothing is stored.** Client ids, codes and tokens are signed with a key derived from the server secret and the password.
- **Lifetimes:** a code lasts 5 minutes and works once, an access token 1 hour, a refresh token 30 days and is replaced each time it's used. A client's registration doesn't expire.
- **Changing `NOTEFEED_PASSWORD` signs every client out:** all registrations, codes and tokens stop working, and each connector must log in again.
- **Restarts:** the record of used codes and refresh tokens is in memory. After a restart, a stolen code or refresh token could be used once more within its lifetime.

## Rate limits and caps

Each client may post, edit or delete `NOTEFEED_RATE_LIMIT` notes per minute (60 by default), from the API and the web UI together. Wrong passwords have their own budget of the same size. A feed password check that is still running counts toward it until it turns out right, so a script that sends more than that many requests to protected feeds at the same instant can see a `429` for some of them. Over it, notefeed answers `429` with a `Retry-After` header, for the rest of the minute; the web UI says how many seconds to wait. The counters live in memory and reset on restart.

!!! warning "Behind a reverse proxy, set `NOTEFEED_TRUST_PROXY=1`"
    notefeed can't see a client's IP on its own, so without `NOTEFEED_TRUST_PROXY` **all clients share one rate-limit bucket**. On an exposed instance, one busy script can then slow everyone down, and an attacker's wrong password guesses can lock the owner out of posting and logging in for up to a minute.

    With `NOTEFEED_TRUST_PROXY=1`, the **last** address in `X-Forwarded-For` is the client: the address the proxy in front of notefeed saw. Anything a client puts in the header itself comes before it and is ignored, so a proxy that overwrites the header and one that appends to it both work. Set it only when that proxy sets `X-Forwarded-For` and clients can't reach notefeed directly. Caddy does this by default; see [Reverse proxy](reverse-proxy.md).

On a public open instance, cap how much space strangers can take:

```yaml
environment:
  NOTEFEED_MAX_FEEDS: 100
  NOTEFEED_MAX_NOTES_PER_FEED: 1000
```

Two settings limit images. `NOTEFEED_MAX_IMAGE_BYTES` is the size of one uploaded image (5242880, 5 MiB, by default; at most 10 MiB, 10485760, because the request body passes through Next's proxy, which buffers at most 10 MiB and would cut a larger image short); over it, the upload answers `413`. `NOTEFEED_MAX_IMAGES_PER_FEED` is how many images one feed may hold (`0`, the default, means no limit); over it, uploading a new image answers `507`, while uploading one the feed already has still works. It defaults to off because there is no way yet to delete a single image through notefeed, so a limit could only be cleared by deleting the feed or removing files by hand. Uploads also count toward `NOTEFEED_RATE_LIMIT`.

```yaml
environment:
  NOTEFEED_MAX_IMAGE_BYTES: 2097152
  NOTEFEED_MAX_IMAGES_PER_FEED: 200
```

Over a cap, posting answers `507`. The caps are checked, not locked, so several posts at the same moment can overshoot by a few. Delete notes or feeds to make room (see [Operations](operations.md#deleting-notes-and-feeds)).

## `PUBLIC_URL`

When `PUBLIC_URL` is unset, notefeed builds links from the `Host` header over `http`. With `NOTEFEED_TRUST_PROXY=1` it uses `X-Forwarded-Proto` and `X-Forwarded-Host` from the reverse proxy first; without it, it ignores them, since any client can send them.

!!! warning "Set `PUBLIC_URL` on a public instance"
    Otherwise the links in the RSS feed, in API responses and in redirects follow whatever `Host` header the client sent. A cache in front could then hand those links to everyone.

Also set it when feed readers reach notefeed by a different address than people do, for example over the LAN.
