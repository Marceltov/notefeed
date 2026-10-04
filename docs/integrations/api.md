# REST API

notefeed's HTTP API lives under `/api/v1`. It's what the [client libraries](clients.md) and the web UI use, and it's stable: a breaking change gets a new version prefix.

- **Post** to `/api/v1/feeds/{feed}/notes`, or the short form `/{feed}`. The body is the note, a file: `Content-Type` says whether it is markdown or a picture, and metadata and creation settings are `X-Note-*`, `X-Feed-Password` and `X-Read-Id` headers. See [Posting notes](../using/posting.md), [Types](../using/posting.md#types) and [Pictures](../using/pictures.md#pictures).
- **Edit** a note with `PUT /api/v1/feeds/{feed}/notes/{id}` (replace its content, same type), change its title or alt text with `PATCH` on the same URL, and **delete** it with `DELETE`. See [Editing and deleting notes](../using/editing.md#editing-and-deleting-notes).
- **Settings and deleting a feed:** `GET`, `PUT` and `DELETE` on `/api/v1/feeds/{feed}` read and replace a feed's title, description and title image and delete the feed with everything in it. See [Feed settings and deleting a feed](../using/feeds.md#feed-settings-in-the-api).
- **Read** a feed's notes as JSON at `/api/v1/feeds/{feed}/notes`, newest first, a page at a time: pass the response's `next` as `before` to get older notes. Add `?tag=ci` to see only notes with that [tag](../using/titles-and-tags.md#tags).
- **Read without the name** at `/api/v1/read/{readId}/notes`, and the feed's title and description at `/api/v1/read/{readId}`: public and read-only, like the [read link](../using/read-links.md). A reserved feed's `readId` is its name.
- **Errors** are JSON, `{"error": "...", "code": "..."}`. Match on the status or the `code`, not on the text.

On an instance with a password, the `feeds` endpoints need `Authorization: Bearer <password>`. The `read` endpoints never do. A feed can also have its own password, sent as `X-Feed-Password`: it gates posting, the `feeds` reads, and changing or deleting the feed's settings, for that feed, and two operations change or remove it. See [A feed with its own password](../using/feed-passwords.md#in-the-api).

Every instance serves its own spec at `/api/v1/openapi.json`, generated from the server's route table, so it always matches the version you run. Point a code generator or an API client at it. The reference below is the spec of the latest release.

<swagger-ui src="../api/openapi.json"/>
