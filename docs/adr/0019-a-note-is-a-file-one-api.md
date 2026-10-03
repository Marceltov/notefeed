---
status: accepted
date: 2026-10-03
decision-makers: Marcel Bruckner
---

# A note is a file: one API for every type, strict about its Content-Type

## Context and Problem Statement

ADR 0018 made a picture a note, but the API, the note JSON, the clients and the web UI still treated markdown and files as two things: a markdown note was posted as JSON, a form or raw text, a picture through a separate endpoint or an image body; the note JSON had a `kind` and a `markdown` field that was empty for pictures; the clients had `post(markdown)` and `upload_image`. Every new file type would have meant another endpoint, another body shape and another field. How are notes posted, changed and read when markdown is just one file type, and what happens to a request that does not say what it sends?

## Considered Options

* Keep the JSON and form bodies for markdown, add raw bodies for files, and accept `text/plain`, `application/x-www-form-urlencoded` and `application/octet-stream` as markdown or "any image" for the sake of curl's defaults.
* One raw body for every type, with `Content-Type` required and exact, and the body verified against it.

## Decision Outcome

Chosen option: the second. A note is a file, and a request says which kind.

* **Post.** `POST /api/v1/feeds/{feed}/notes` (and `POST /{feed}`): the body is the file's bytes, `Content-Type` is its type. Metadata and creation settings are headers: `X-Note-Title`, `X-Note-Tags`, `X-Note-Alt`, `X-Note-Name`, `X-Feed-Password`, `X-Read-Id`. Non-ASCII header text travels as its UTF-8 bytes.
* **Strict types.** `Content-Type` must be exactly a media type of the registry (`backend/note/types.ts`): `text/markdown` (optionally `charset=utf-8`) or `image/png`, `image/jpeg`, `image/gif`, `image/webp`. A missing, generic or unknown type, and everything curl sends by default, is `415`, with a message that names the accepted types. Nothing is guessed from the bytes.
* **Verified, not trusted.** The body must be what the type declares: an image carries its format's signature (so SVG and a JPEG sent as PNG are refused), markdown is valid UTF-8, not blank, within 100 KB. A refused post creates nothing, not even a protected empty feed.
* **Edit.** `PUT` replaces the content with the same rules; a note keeps its type, so the type must be the note's own. `PATCH` takes JSON `{title?, alt?}`. An empty string removes one.
* **Note JSON.** `type` (media type), `file`, `file_url`, `size`, `title`, and `content` for text types only. `kind` and `markdown` are gone. Fields that are always sent are required: client and server are released together, and this is before the first release, so there is no compatibility with older servers.
* **One typed body.** The OpenAPI document lists every accepted media type as one binary body, so the generated clients (browser, npm, PyPI) send any file with its type. The old picture endpoint is gone.
* **Files are revalidated, not cached for good.** A `PUT` can replace a picture under the same URL, so `/r/<read id>/<file>` is served with `Cache-Control: no-cache` and an `ETag` (a hash of the bytes) and answers `304` while the file is unchanged. (Amends ADR 0017, which cached pictures for a year because their names were hashes.)
* **No JavaScript fallback for notes.** Posting, editing and deleting a note need the web UI's JavaScript, which uses this API; the multipart and urlencoded form handling and the `/edit` and `/delete` form routes are removed. The settings, password, login and delete-feed forms are unchanged.
* **Clients and MCP.** `post(content, type=…)`, `edit(id, content)` and `update(id, title, alt)`; `notefeed post --file` replaces `notefeed image`; MCP `post_file` replaces `upload_image`.
* **Code.** Media types live in the registry; a new type is a `Note` subclass and one registry entry, and every endpoint, client and the UI follow without a new shape. (Amends ADR 0018.)

### Consequences

* Good, because markdown and files share one request shape, one note shape and one check, so a new type does not touch the API.
* Good, because the declared type is a contract: a client that sends the wrong thing gets a clear `415` instead of a guess.
* Good, because the generated clients can type the body, so no hand-written requests.
* Bad, because the shortest curl post now needs a header (`-H "Content-Type: text/markdown"`), and a script that relied on curl's default type breaks.
* Bad, because this changes the API and both client packages incompatibly, and the web UI no longer posts without JavaScript.
* Bad, because a PUT cannot change a note's type: replacing a PNG with a JPEG is delete and post.
