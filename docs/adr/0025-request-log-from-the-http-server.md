---
status: accepted
date: 2026-10-09
decision-makers: Marcel Bruckner
---

# The request log: one line per request, written from Node's HTTP server

## Context and Problem Statement

notefeed logged at start-up and when something went wrong (ADR 0015), and left the line per request to the reverse proxy. That log is the wrong source (issue #150): the proxy sees the whole path and with it the feed name, which works like a password (ADR 0001), so it is only safe after filtering by patterns that must follow every new route; and it does not know which route matched or why a request was refused.

notefeed's routes are answered in several places: Next's pages, its route handlers, the `/api/v1` dispatcher behind one catch-all, `proxy.ts` (redirects and the lock), and Next itself for static files. Next has no hook that sees a finished response, and a custom server cannot be combined with the standalone build.

## Considered Options

* A subscription to Node's `http.server.request.start` diagnostics channel, set up in `instrumentation.ts`.
* A wrapper around every route handler and page.
* `proxy.ts`.
* A custom Next server.

## Decision Outcome

Chosen option: the diagnostics channel. It is published by Node's HTTP server for every request before Next sees it, whoever answers, so there is one place and no route can be forgotten. The subscriber opens a per-request scope (`AsyncLocalStorage`, `backend/requestscope.ts`) and writes the line when the response closes (`backend/http/requestlog.ts`). A wrapper would have to be put on each of some thirty routes and cannot see static files, Next's own 404s or the proxy's redirects; `proxy.ts` runs before the answer exists, so it knows neither the status nor the time; a custom server gives up the standalone image.

* **Fields:** `method`, `route`, `status`, `ms`, `bytes`, `outcome` and `req`. Never the path, the query, the feed name, a read id, the client's address, a header or anything of the body.
* **`route` is a pattern.** It comes from the path's shape, matched against the list of the app's routes (`ROUTES`, which a test holds to the `app/` folder). A handler that knows better says so in the scope: the dispatcher names the operation's path (`/api/v1/feeds/[feed]/notes`, also for a post that came by `/<feed>`), the file route names itself (it is reached by a rewrite). A path that matches nothing has no `route`.
* **`outcome` is the reason notefeed already knows:** the error's stable `code` (`shared/errors.ts`), set where errors become answers (`errorReply`), plus a few fixed words (`error`, `method_not_allowed`, `aborted`).
* **`req`, a request id:** random, made per request, and added by the logger to every line logged inside the scope, so the event lines and errors of a request can be matched to its request line. It is not sent to the client and not taken from a header.
* **`bytes` is what the socket sent for the response,** headers included: a streamed page has no length of its own to read.
* **Levels:** `info`; `debug` for Next's static files, top-level files (icons, the manifest) and `/metrics`, so that `info` stays readable. There is no health-check route.
* **Switch:** `NOTEFEED_LOG_REQUESTS=0` turns the line off and keeps the scope (and so `req` on the other lines). `NOTEFEED_LOG_LEVEL=warn` hides it with everything else at `info`.
* **Events at `info`:** `feed created`, `feed deleted`, `note posted` (kind and size), `note deleted` (kind), an image stored in or deleted from the image store, `password login succeeded`, beside the sign-in and authorization lines of ADR 0015. They are logged where the thing happens (`backend/feeds.ts`, `backend/notes.ts`), so the API, MCP and the web UI are covered alike.

* **A reader who leaves is not an error.** React raises `The destination stream closed early.` for a page whose reader went away, and Next prints it as a plain line with a stack. `console.error` is wrapped at start-up to drop exactly that error; the request line's `aborted` says the same.

### Consequences

* Good, because an operator can turn the proxy's access log off, or strip it to nothing that identifies a feed or a client, and still see what the instance does.
* Good, because a new route is logged without anyone thinking of it; only its pattern has to be added to `ROUTES`, and a test fails until it is.
* Bad, because the scope is entered with `AsyncLocalStorage.enterWith` from a diagnostics subscriber: it relies on Node publishing the event synchronously on the request's own call path, and on Next keeping the async context from there to the handlers. A test covers the first against a plain Node server, and an e2e test the second against the built app (`e2e/requestlog.spec.ts` reads the server's log).
* Bad, because the log grows with traffic: one line per request at the default level.
* Bad, because `bytes` counts headers and is right only while a connection carries one response at a time (HTTP/1.1 without pipelining, which is what Node serves).
