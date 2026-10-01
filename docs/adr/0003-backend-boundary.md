---
status: accepted; the server-action part is superseded by ADR 0005
date: 2026-10-01
decision-makers: Marcel Bruckner
---

# A framework-free backend behind one boundary module

## Context and Problem Statement

Server code lived in a flat `lib/` that pages, server actions, route handlers and the proxy imported from freely. The posting rules were written twice: once in the HTTP handler (`lib/post.ts`) and once in the compose box's server action. Each copy had its own error strings, and the action capitalised the handler's strings to show them in the UI. Disk access was split across three modules, and environment variables were read in eight places. The backend may move into its own service later. How should the code be split so that move stays a small, well-defined change?

## Decision Drivers

* One place for every rule about posting a note (name, rate limit, caps, size, emptiness).
* The frontend must not depend on how the backend stores or computes anything.
* A move out of process should change one file on the frontend side, not every page.
* Calls between frontend and backend stay in-process for now: no HTTP hop inside one container.

## Considered Options

* Keep `lib/`, de-duplicate the posting code in place.
* `backend/` with a single boundary module (`backend/index.ts`) that the frontend calls in-process, enforced by lint.
* Split now: the frontend talks to the backend over HTTP only.

## Decision Outcome

Chosen option: "`backend/` with a single boundary module", because it makes the future cut explicit and checkable without paying for it today.

* `backend/` is plain TypeScript: no `next`, no React, no imports from the frontend. Inside it:
  * `data/` is the only code that touches the disk (feed folders, note files, the secret).
  * `feeds.ts`, `notes.ts`, `auth.ts` and `limits.ts` hold the rules, and `config.ts` holds every environment variable.
  * `posting.ts` is the one way a note gets posted, for the API and the web UI alike.
  * `http/` contains standard `Request` → `Response` handlers.
* `backend/errors.ts` defines a class for each refusal (`InvalidFeedError`, `RateLimitedError` with `retryAfter`, `FeedLimitError`, …). Messages are the API's wording. `backend/http` maps classes to HTTP statuses in one table, and `app/actions.ts` maps them to UI sentences. No caller parses a message string.
* `backend/index.ts` is the boundary: it exposes the error classes, auth checks, `postNote`, the URL helpers, the HTTP handlers, and four read queries (`getFeed`, `getFeedNote`, `getReadFeed`, `getReadNote`). Each query is shaped like the endpoint it would become.
* `shared/` holds pure code used by both sides and the browser (note titles and ids for the compose preview).
* `eslint.config.mjs` enforces it:
  * `app/`, `components/` and `proxy.ts` may import `@/backend` but nothing under it.
  * `backend/` may not import `next`, React or the frontend.
  * `shared/` may not import Node, the backend or the frontend.
  * Tests are exempt.
* Server actions stay: they are the frontend's adapter and call `postNote` and `login` through the boundary. `proxy.ts` therefore still tells a server-action POST to `/<feed>` apart from a script's.

### Consequences

* Good, because posting rules, error mapping and configuration each live in one file.
* Good, because the boundary is checked by lint, not by convention.
* Good, because moving the backend out means four steps:
  1. Serve `backend/http/*` and add GET endpoints for the four queries.
  2. Turn `backend/index.ts` into an HTTP client.
  3. Have the reverse proxy route `POST /<feed>` to the new service.
  4. Pages and actions stay unchanged.
* Bad, because the boundary passes `Date` objects and throws error classes in-process. Over HTTP both need a wire format: ISO strings, and a status-to-class table like the client packages already have.
* Bad, because `proxy.ts` keeps its header-based split between scripts and server actions.

### Confirmation

`npm run lint` fails on an import that crosses the boundary. Vitest covers the posting rules through the HTTP handler and through the server action, and Playwright covers the UI flows on the production build.
