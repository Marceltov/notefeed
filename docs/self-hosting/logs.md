# Logs

notefeed writes its logs to standard output as JSON lines: one object per line, with the level as a word (`level`), an ISO time (`time`), the part of notefeed that logged it (`component`), a fixed message (`msg`) and fields with the details. For example, the line at start-up:

```json
{"level":"info","time":"2026-10-02T09:00:00.120Z","component":"startup","node":"v22.23.3","dataDir":"/data","passwordSet":true,"oidcProviders":1,"publicUrlSet":true,"trustProxy":true,"maxFeeds":0,"maxNotesPerFeed":0,"maxImagesPerFeed":0,"logLevel":"info","logRequests":true,"metrics":false,"msg":"notefeed started"}
```

`NOTEFEED_LOG_LEVEL` sets how much is logged: `error`, `warn`, `info` (the default), `debug` or `silent`. Each level includes the ones before it. A value that isn't a level counts as `info`, and the start-up log warns about it.

Read the logs with `docker compose logs notefeed`, or your container runtime's equivalent; `docker compose logs -f notefeed` follows them. For lines a person can read, pipe them through pino-pretty, which `npx` fetches on first use: `docker compose logs --no-log-prefix notefeed | npx pino-pretty`. To pick lines out, filter on the JSON, for example `docker compose logs --no-log-prefix notefeed | grep '"level":"warn"'`, or with `jq`. Next.js prints a few plain lines of its own when the server starts, and a plain line for an error of its own; its error for a reader who left while a page was being sent (`The destination stream closed early.`) is left out, because the request line already says `aborted`.

## The request line

Every request notefeed answers gets one line, written by notefeed itself when the response is done:

```json
{"level":"info","time":"2026-10-09T10:00:00.120Z","component":"http","req":"q0Zr1fJx","method":"POST","route":"/api/v1/feeds/[feed]/notes","status":201,"ms":12,"bytes":412,"msg":"request"}
```

| Field | Example | What it is |
|---|---|---|
| `req` | `q0Zr1fJx` | A random id for this request. Every other line logged while the request was answered has the same `req`, so a `note posted` or a `request failed` can be matched to its request. |
| `method` | `GET` | The request's method. |
| `route` | `/[feed]`, `/api/v1/feeds/[feed]/notes`, `/r/[readId]/feed.xml`, `/mcp` | The pattern of the route that answered, never the path that was asked for. A post to `/<feed>` is logged as the API operation it is, `/api/v1/feeds/[feed]/notes`. Absent for a path that is none of notefeed's. |
| `status` | `200` | The status of the answer. |
| `ms` | `12` | The time from the request's arrival to the end of the answer, in milliseconds. |
| `bytes` | `4312` | The bytes sent for the answer, its headers included. |
| `outcome` | `rate_limited`, `auth`, `not_found` | Only for a refusal: why. It is the `code` of the API's error body (`auth`, `rate_limited`, `too_many_attempts`, `not_found`, `invalid_feed`, `too_large` and so on); `auth` too when a locked instance sends a visitor to the login page; `method_not_allowed`; `error` for an unexpected failure (a `500`, which has its own `request failed` line); `aborted` when the client went away before the answer was complete. |

The line never holds the path, the query, the feed name, a read id, the client's address, the user agent, the referrer, a header or anything of the body.

The app's own scripts, styles and icons (`"route":"/_next/*"` and `"route":"/[file]"`) and the scrape of `/metrics` are logged at `debug`, so that `info` shows what people and scripts do. `NOTEFEED_LOG_REQUESTS=0` turns the request line off and leaves every other line as it is; `NOTEFEED_LOG_LEVEL=warn` hides it together with the other `info` lines.

### Your reverse proxy's access log

With the request line you do not need the proxy's access log to see what the instance does, and the proxy's log is the risky one: the proxy sees the whole path, and the path holds the feed name, which works like a password. Stored next to the client's address, it says who reads and posts to which feed. Turn the proxy's access log off, or make it leave out the path, the query and the client's address. Replacing feed names by patterns in the proxy is fragile: the patterns have to follow every route notefeed adds.

## The other lines

| Level | `component` | `msg` | When |
|---|---|---|---|
| `info` | `http` | `request` | Every request: see [The request line](#the-request-line). `debug` for static files and `/metrics`. |
| `info` | `feeds` | `feed created`, `feed deleted` | A feed came to exist with its first note, or was deleted with everything in it; `protected` says whether it was created with a feed password. Never its name. |
| `info` | `notes` | `note posted`, `note deleted` | A note was stored or deleted. `kind` is `markdown` or `image`, and a posted note has its size in `bytes`; a picture sent with a text is a `note posted` of its own. Never the feed, the note's id or its title. |
| `info` | `storage` | `image stored in the image store`, `image deleted from the image store` | With [image bytes kept outside the database](storage.md#image-bytes-outside-the-database): an image's bytes were written to the image store (`bytes` is their size) or removed from it, when its note was posted, replaced or deleted or its feed was deleted. Never the object's key. |
| `info` | `auth` | `password login succeeded` | The instance password was right on the login page. |
| `info` | `startup` | `notefeed started` | Once, at start-up, with the Node version, `DATA_DIR`, whether the instance password, `PUBLIC_URL` and `NOTEFEED_TRUST_PROXY` are set, the number of sign-in providers, the caps, the log level and whether requests are logged. |
| `warn` | `startup` | `sign-in provider configured partially; it stays off` | At start-up, for each [sign-in provider](sign-in/index.md) with some but not all of its four variables set; `missing` names the variables that are missing. |
| `warn` | `startup` | `sign-in is on without PUBLIC_URL: the redirect URI comes from each request's Host header` | At start-up, when sign-in is on and `PUBLIC_URL` is not set. |
| `warn` | `startup` | `NOTEFEED_LOG_LEVEL is not a level; using info` | At start-up. |
| `warn` | `feeds` | `reserved feeds are listed but have no password; they are not created` | At start-up, when `NOTEFEED_RESERVED_FEEDS` is set and `NOTEFEED_RESERVED_PASSWORD` is not. |
| `warn` | `feeds` | `reserved feed exists but is not protected`, or `reserved feed exists with another read id than its name` | At start-up, for a [reserved feed](reserved-feeds.md#reserved-feeds) that already existed as an ordinary feed when its name was listed; `feed` is the reserved name and `hint` says what to do: delete its folder in `DATA_DIR` and restart, so it is recreated protected with its name as read id. With `NOTEFEED_RESERVED_PASSWORD` set, this check makes notefeed read its feeds and create the missing reserved feeds at start-up, rather than at the first request. |
| `info` | `oidc` | `sign-in succeeded` | A sign-in worked; `provider` is the provider's id. |
| `warn` | `oidc` | why a sign-in failed | See [What the log says](sign-in/troubleshooting.md#what-the-log-says). |
| `info` | `oauth` | `authorization granted` | An MCP client got access; `via` is `password` or the sign-in provider's id. |
| `warn` | `oauth` | `refresh refused` | An MCP client's sign-in ended, so its refresh token no longer works; `reason` is `sign-in switched off` or `sign-in past its lifetime`. |
| `warn` | `auth` | `password login failed` | A wrong instance password on the login page (`"page":"login"`) or on an MCP client's authorize page (`"page":"authorize"`). Refusals for [too many attempts](limits.md#rate-limits-and-caps) are not logged at this level. |
| `warn` | `limits` | `cap reached` | A post was refused by `NOTEFEED_MAX_FEEDS`, `NOTEFEED_MAX_NOTES_PER_FEED` or `NOTEFEED_MAX_IMAGES_PER_FEED`; `kind` is `feed`, `note` or `image`. |
| `warn`, `error` | `feeds` | a feed's read id or a leftover folder | A problem with a feed's files that notefeed works around, such as a `.readid` it can't read; the feed's name is never in it. |
| `error` | `http`, `mcp` | `request failed`, `tool failed` | An unexpected failure, answered with a bare `500` or `internal error`; `err` carries the error, with everything below the data directory in a path replaced by `<path>` (so no feed name or note title). |
| `error` | `http` | `an operation answered a status it doesn't declare` | A bug: an API operation answered a status its OpenAPI description doesn't list, and the client got a bare `500`; `operation` is the operation's id and `status` the status it tried to send. |
| `error` | `posting` | `a picture of a failed post could not be removed` | A post or an edit of a note with pictures failed while storing, and one of the picture notes it had already stored could not be removed again: that picture may be left in the feed (the removal also reports a file that was already gone) and can be deleted by hand. `note` is the picture note's id (its file in `DATA_DIR` starts with it), and `err` carries the error when the removal itself failed; the feed's name is never in it. |
| `debug` | `limits` | `rate limit reached` | A request over `NOTEFEED_RATE_LIMIT`; `kind` is `post` or `password`. |
| `debug` | `auth` | `password bearer refused` | A script sent a wrong instance password as its bearer token. |

What is never logged: note content, feed names (they work like passwords; a reserved feed's name, which you chose, is the one exception), passwords, tokens, secrets, authorization codes, `state` and `nonce` values, cookies, e-mail addresses, names and other claim values, the name an MCP client gave itself, client IP addresses, and request headers or bodies. The request line holds a route's pattern, never its path.
