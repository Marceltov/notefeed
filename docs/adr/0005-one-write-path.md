---
status: accepted
date: 2026-10-01
decision-makers: Marcel Bruckner
---

# One write path: every POST is a backend route handler, routed by method and path

## Context and Problem Statement

`/<feed>` is both a page and the API scripts post to (ADR 0001). The compose box and the login form were server actions, and Next posts a server action to the page's own URL. So `proxy.ts` had to guess, from `next-action`, `Content-Type` and `Accept`, whether a `POST /<feed>` was the web UI or a script. The guess was fragile:

* A plain HTML form on another site that posts to a feed was taken for a server action and failed.
* A reverse proxy in front of an extracted backend (ADR 0003) would have had to repeat the same guess.

Posting rules also had two entry points: the HTTP handler and the server action. (Issue #29.)

## Decision Drivers

* Routing must depend only on the method and the path, so a reverse proxy can do it.
* The web UI and scripts should use one write path, so a bug shows up in both.
* The web UI must keep working without JavaScript.
* A locked instance must not become open to cross-site form posts.

## Considered Options

* Keep the server actions; guess with a sharper header (`Sec-Fetch-Dest: document`).
* Drop the server actions: the compose box and login become plain forms that post to backend route handlers.

## Decision Outcome

Chosen option: "Drop the server actions", because it removes the guessing instead of refining it, and leaves the frontend with no write code at all.

* **Compose box:** a `multipart/form-data` form to `POST /<feed>`, the same handler scripts use, which now accepts a form's `markdown` field.
  * A request that asks for HTML (`Accept: text/html`) gets a 303 back to the feed page, with `?posted=<id>` or `?error=<code>&retry=<s>`. Everything else gets JSON.
  * With JavaScript, the box sends the same request with `fetch()`, asks for JSON and shows errors inline. Without JavaScript, the browser follows the redirect.
* **Login and logout:** `POST /login` and `POST /logout` are backend handlers (`backend/http/session.ts`) that set or clear the cookie and redirect. Next can't put a route handler next to the `/login` page, so the proxy rewrites `POST /login` to `/api/login`, just as it rewrites `POST /<feed>` to the notes route.
* **Proxy rule:** a POST to one path segment goes to `/api/login` for `login`, stays where it is for `logout`, and goes to the notes route for anything else. Pages are GET-only.
* **Auth on a locked instance:** `POST /<feed>` accepts either the bearer password or the session cookie. The cookie is accepted only when the `Origin` header's host is the instance's public host. That check, together with the cookie's `SameSite=Lax`, stands in for the CSRF check that Next's server actions used to do.
* **Error codes:** every refusal has a stable code (`shared/errors.ts`). It is sent in API error bodies as `code` and in the web UI's `?error=`. The UI's wording lives in `app/_lib/messages.ts`.

### Consequences

* Good, because `proxy.ts` reads no headers to route, and the same rule works in Caddy or nginx.
* Good, because the UI uses the public API, so the e2e tests exercise it, including a JavaScript-off run.
* Good, because `curl -F markdown=@note.md` now works instead of returning 415.
* Bad, because the API gains a second response shape (303 for `Accept: text/html`) and a `code` field, both documented in posting.md. The client packages ignore both.
* Bad, because without JavaScript the typed text is lost when a post is refused. It was lost before too.

### Confirmation

* `proxy.test.ts` checks that the same `POST /<feed>` is rewritten whatever its headers.
* `backend/http/notes.test.ts` covers form posts, the 303 responses, and cookie auth with the same-origin check (another site, no `Origin` and a bad `Origin` all get 401).
* `backend/http/session.test.ts` covers login and logout.
* Playwright posts with and without JavaScript, and through a login on a locked instance.
