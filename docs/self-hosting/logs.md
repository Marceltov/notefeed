# Logs

notefeed writes its logs to standard output as JSON lines: one object per line, with the level as a word (`level`), an ISO time (`time`), the part of notefeed that logged it (`component`), a fixed message (`msg`) and fields with the details. For example, the line at start-up:

```json
{"level":"info","time":"2026-10-02T09:00:00.120Z","component":"startup","node":"v22.23.3","dataDir":"/data","passwordSet":true,"oidcProviders":1,"publicUrlSet":true,"trustProxy":true,"maxFeeds":0,"maxNotesPerFeed":0,"maxImagesPerFeed":0,"logLevel":"info","metrics":false,"msg":"notefeed started"}
```

`NOTEFEED_LOG_LEVEL` sets how much is logged: `error`, `warn`, `info` (the default), `debug` or `silent`. Each level includes the ones before it. A value that isn't a level counts as `info`, and the start-up log warns about it.

Read the logs with `docker compose logs notefeed`, or your container runtime's equivalent; `docker compose logs -f notefeed` follows them. For lines a person can read, pipe them through pino-pretty, which `npx` fetches on first use: `docker compose logs --no-log-prefix notefeed | npx pino-pretty`. To pick lines out, filter on the JSON, for example `docker compose logs --no-log-prefix notefeed | grep '"level":"warn"'`, or with `jq`. Next.js prints a few plain lines of its own when the server starts.

| Level | `component` | `msg` | When |
|---|---|---|---|
| `info` | `startup` | `notefeed started` | Once, at start-up, with the Node version, `DATA_DIR`, whether the instance password, `PUBLIC_URL` and `NOTEFEED_TRUST_PROXY` are set, the number of sign-in providers, the caps and the log level. |
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

What is never logged: note content, feed names (they work like passwords; a reserved feed's name, which you chose, is the one exception), passwords, tokens, secrets, authorization codes, `state` and `nonce` values, cookies, e-mail addresses, names and other claim values, the name an MCP client gave itself, client IP addresses, and request headers or bodies. There is no line per request: your reverse proxy's access log has that.
