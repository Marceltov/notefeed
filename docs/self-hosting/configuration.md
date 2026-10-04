# Configuration

notefeed is configured with environment variables. With Compose, set them under `environment:` in `compose.yaml`, or in `.env` next to it and reference them there. None is required: with none set, notefeed runs as an open instance.

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | derived from the request | Absolute base URL used for links in the feed and API responses, e.g. `https://notes.example.com`. Set it on a public instance, see [below](#public_url). |
| `NOTEFEED_PASSWORD` | none: open instance | Instance password. When set, posting needs it as a bearer token and the web UI needs a login. Read links stay open. See [The password](access.md#the-password). |
| `NOTEFEED_TRUST_PROXY` | off | Set to `1` behind a reverse proxy, so rate limits apply per client IP from `X-Forwarded-For`, and links without `PUBLIC_URL` follow `X-Forwarded-Proto` and `X-Forwarded-Host`. See [Rate limits and caps](limits.md#rate-limits-and-caps). |
| `NOTEFEED_RATE_LIMIT` | `60` | Posts, edits and deletes per client per minute, and separately wrong passwords per client per minute. `0` or less turns the limit off. |
| `NOTEFEED_MAX_FEEDS` | `0`: no limit (so is any value below 1) | Most feeds on the instance. Posting to a new feed beyond it answers `507`. |
| `NOTEFEED_RESERVED_FEEDS` | empty | Comma-separated feed names that can't be created, e.g. `news,announcements,updates`, in addition to notefeed's own route names. Posting to one answers `400` (`reserved_feed`). A feed that already has such a name keeps working. |
| `NOTEFEED_RESERVED_PASSWORD` | none | Password of the reserved feeds. When set, each reserved name (from `NOTEFEED_RESERVED_FEEDS`) exists from start-up as a [protected feed](../using/feed-passwords.md#in-the-api) with this password and its own name as read id (`/r/news`, `/r/news/feed.xml`), so only the operator can post to `news` while anyone can subscribe at a link that never changes. Without it, reserved names don't exist. It is only applied when a feed is created: change it later in the feed's settings. |
| `NOTEFEED_MAX_NOTES_PER_FEED` | `0`: no limit (so is any value below 1) | Most notes in one feed. Posting beyond it answers `507`. |
| `NOTEFEED_PARSE_TIMEOUT_MS` | `10000` (10 s) | How long reading a markdown text may take when it is posted with pictures (to find the `![](name)` references). It runs in a worker thread, so a text built to be slow costs only its sender that time and never stalls the server; past the limit the request is refused with `400`. |
| `NOTEFEED_METRICS` | off | `1` turns on `GET /metrics`, the [metrics](metrics.md#metrics) in the Prometheus text format. Off, `/metrics` answers `404`. Any other value is off. |
| `NOTEFEED_METRICS_TOKEN` | none | With metrics on, `/metrics` needs `Authorization: Bearer <token>` (otherwise `401`). Without a token it is open to everyone who can reach the app, and the start-up log warns about it: set one unless your reverse proxy keeps `/metrics` private. |
| `NOTEFEED_MAX_IMAGE_BYTES` | `5242880` (5 MiB) | Largest image, in bytes, at most 10 MiB (`10485760`; a larger value counts as that). Beyond it, the upload answers `413`. |
| `NOTEFEED_ALLOW_CUSTOM_IDS` | on | Whether a feed's read id can be [chosen](../using/read-links.md#choosing-a-feeds-read-id). `0` leaves only random ones: a chosen `read_id` is refused with `400`, and the settings page offers only **Generate a random one**. |
| `NOTEFEED_MAX_IMAGES_PER_FEED` | `0`: no limit (so is any value below 1) | Most image notes in one feed (markdown notes have their own limit). A new image beyond it answers `507`. |
| `NOTEFEED_SECRET` | random, kept in `DATA_DIR/.secret` | The server secret, at least 32 characters (`openssl rand -hex 32`); notefeed refuses a shorter one, or a `.secret` file shorter than 32 bytes. It signs the unlock cookies of [protected feeds](../using/feed-passwords.md#in-the-api) and the [OAuth](oauth.md#oauth) tokens of MCP clients, and the [read links](../using/read-links.md) of feeds created before feed deletion was added are derived from it. Changing it locks unlocked browsers again, signs MCP clients out and changes the read link of each of those older feeds; feeds created since have a stored read id and keep theirs. |
| `NOTEFEED_TITLE` | `notefeed` | Title of the RSS feed and of the read-only view, for a feed that has no title of its own. |
| `NOTEFEED_OIDC_ISSUER`, `NOTEFEED_OIDC_CLIENT_ID`, `NOTEFEED_OIDC_CLIENT_SECRET`, `NOTEFEED_OIDC_ALLOW` | none: sign-in off | Optional sign-in through your OpenID Connect provider, so notes carry a verified sender. On only when all four are set; needs `PUBLIC_URL` and `NOTEFEED_SECRET`. See [Sign-in and sender](sign-in/index.md). |
| `NOTEFEED_OIDC_LABEL` | the issuer's host | Optional. The text after **Sign in with** on the button for this provider. |
| `NOTEFEED_OIDC_<NAME>_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_ALLOW`, `_SENDER_CLAIM`, `_LABEL` | none | Optional further providers, each with a name of your choosing in `<NAME>` (capitals, digits, underscores). Nothing is predefined. See [Several providers](sign-in/providers.md#several-providers). |
| `NOTEFEED_OIDC_SENDER_CLAIM` | `name,email` | Optional. Comma-separated id_token claims tried in order for the sender shown on notes and stored in the note file, so pick one that is fine to publish (`sub` is opaque, `email` exposes an address). Not needed to turn sign-in on. See [Sign-in and sender](sign-in/index.md). |
| `NOTEFEED_LOG_LEVEL` | `info` | How much notefeed logs: `error`, `warn`, `info`, `debug` or `silent`. Any other value counts as `info`. See [Logs](logs.md#logs). |
| `DATA_DIR` | `/data` | Folder holding the feeds, one subfolder each. |
| `TZ` | `UTC` | Time zone for the times shown in the web UI, e.g. `Europe/Berlin`. |
| `PUID`, `PGID` | owner of `DATA_DIR` | User and group notefeed runs as, and so the owner of new note files. By default the owner of the data folder; uid/gid 1000 if that is root. Docker image only. |

An empty value counts as unset.

## `PUBLIC_URL`

When `PUBLIC_URL` is unset, notefeed builds links from the `Host` header over `http`. With `NOTEFEED_TRUST_PROXY=1` it uses `X-Forwarded-Proto` and `X-Forwarded-Host` from the reverse proxy first; without it, it ignores them, since any client can send them.

!!! warning "Set `PUBLIC_URL` on a public instance"
    Otherwise the links in the RSS feed, in API responses and in redirects follow whatever `Host` header the client sent. A cache in front could then hand those links to everyone.

Also set it when feed readers reach notefeed by a different address than people do, for example over the LAN.
