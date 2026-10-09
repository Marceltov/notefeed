---
status: accepted
date: 2026-10-02
decision-makers: Marcel Bruckner
---

# Logging with pino: JSON lines on stdout, no transports, a fixed never-log list

## Context and Problem Statement

notefeed had no logging: a handful of `console.error` calls, each worded differently, with no levels, no setting and no common format. A failed OIDC sign-in left no trace (issue #65), and #71 added `oidc:` lines through a local helper. Container logs are shipped from the server, so a format a log pipeline can parse earns its place. Issue #73: how should notefeed log, what, and what must it never log?

## Considered Options

* Our own small logger: plain text lines `<level> <component>: <message> key=value`, with an optional JSON format.
* winston.
* consola.
* pino.

## Decision Outcome

Chosen option: "pino", because it writes JSON lines by default, is small and fast, has child loggers per component, levels and path-based redaction built in, and is on Next's own list of server packages. Our own logger would have meant writing and testing the escaping, levels and redaction ourselves; winston and consola bring formats and transports notefeed doesn't need, and consola aims at readable console output rather than log pipelines.

* **Format:** one JSON object per line on standard output, with `level` as a word, an ISO `time`, `component` and `msg`; details are fields. Messages are fixed text, so lines can be counted and searched. No transports (they run in worker threads, which the standalone build doesn't trace) and no pino-pretty in the image: people who want readable lines pipe them through `npx pino-pretty`.
* **Levels:** `NOTEFEED_LOG_LEVEL` is `error`, `warn`, `info` (default), `debug` or `silent`; any other value counts as `info` and the start-up log warns about it. `info` holds the start-up line, successful sign-ins and granted MCP authorizations; `warn` holds what an operator should look at (failed sign-ins and logins, caps reached, configuration mistakes); `debug` holds rate limits and wrong bearer passwords.
* **Never logged:** note content, feed names (they work like passwords, ADR 0001), passwords, tokens, secrets, codes, `state`, `nonce`, cookies, e-mail addresses, names and other claim values, an MCP client's self-chosen name, client IP addresses, request headers and bodies. A sign-in success names the provider, never the person. The names of reserved feeds (ADR 0012) are the one exception: the operator chose them and they are public by intent.
* **Redaction is a safety net:** pino's `redact` replaces fields such as `password`, `token`, `code`, `state`, `nonce`, `email` and `name` with `[redacted]` (its wildcards reach one level down, not into deeper objects or arrays), but call sites still never pass those values. String fields are capped at 200 characters and stripped of control characters, so a value can't fake another line.
* **No access log:** the reverse proxy already has one. (Superseded by [ADR 0025](0025-request-log-from-the-http-server.md): the proxy's log holds the feed name.)
* **Logging never changes behaviour:** a failing output is swallowed, and no status code, body, redirect or rate-limit count depends on a log call.

### Consequences

* Good, because the logs can be filtered by level and component in any log pipeline without parsing text.
* Good, because there is one place (`backend/log.ts`) that decides the format, the level and what is redacted.
* Bad, because notefeed gains a runtime dependency. It is listed in `serverExternalPackages` in `next.config.ts`, so it stays a plain Node `require` and the standalone build traces it into the image; a change in how Next traces packages would need checking against a production build.
* Bad, because an error's message and stack can name a file path, and a path under `DATA_DIR` names a feed and, for a note, its title: errors are logged through a serializer that replaces everything below the data directory (as configured, resolved and with symlinks resolved) with `<path>` and keeps only the type, message, stack, `code`, `errno` and `syscall`. An Error passed as a log call's only argument is turned into that field too. A new way of logging errors must go through it.
* Neutral, because the raw lines are less readable for a person at a terminal than plain text; pino-pretty covers that outside the image.
