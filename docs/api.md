# REST API

notefeed's HTTP API lives under `/api/v1`. It's what the [client libraries](clients.md) and the web UI use, and it's stable: a breaking change gets a new version prefix.

- **Post** to `/api/v1/feeds/{feed}/notes`, or the short form `/{feed}` (see [Posting notes](posting.md)).
- **Edit** a note with `PUT /api/v1/feeds/{feed}/notes/{id}` and **delete** it with `DELETE` on the same URL. See [Editing and deleting notes](posting.md#editing-and-deleting-notes).
- **Images:** `POST /api/v1/feeds/{feed}/images` stores an uploaded PNG, JPEG, GIF or WebP image and answers with its URL and the markdown to use it in a note. See [Images](posting.md#images).
- **Settings and deleting a feed:** `GET`, `PUT` and `DELETE` on `/api/v1/feeds/{feed}` read and replace a feed's title, description and title image and delete the feed with everything in it. See [Feed settings and deleting a feed](posting.md#feed-settings-and-deleting-a-feed).
- **Read** a feed's notes as JSON at `/api/v1/feeds/{feed}/notes`, newest first, a page at a time: pass the response's `next` as `before` to get older notes.
- **Read without the name** at `/api/v1/read/{readId}/notes`, and the feed's title and description at `/api/v1/read/{readId}`: public and read-only, like the [read link](feed.md). A reserved feed's `readId` is its name.
- **Errors** are JSON, `{"error": "...", "code": "..."}`. Match on the status or the `code`, not on the text.

On an instance with a password, the `feeds` endpoints need `Authorization: Bearer <password>`. The `read` endpoints never do. A feed can also have its own password, sent as `X-Feed-Password`: it gates posting, the `feeds` reads, and changing or deleting the feed's settings, for that feed, and two operations change or remove it. See [A feed with its own password](posting.md#a-feed-with-its-own-password).

Every instance serves its own spec at `/api/v1/openapi.json`, generated from the server's route table, so it always matches the version you run. Point a code generator or an API client at it. The reference below is the spec of the latest release.

<swagger-ui src="api/openapi.json"/>
