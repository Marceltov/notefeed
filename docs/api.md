# REST API

notefeed's HTTP API lives under `/api/v1`. It's what the [client libraries](clients.md) and the web UI use, and it's stable: a breaking change gets a new version prefix.

- **Post** to `/api/v1/feeds/{feed}/notes`, or the short form `/{feed}` (see [Posting notes](posting.md)).
- **Read** a feed's notes as JSON at `/api/v1/feeds/{feed}/notes`, newest first, a page at a time: pass the response's `next` as `before` to get older notes.
- **Read without the name** at `/api/v1/read/{readId}/notes`: public and read-only, like the [read link](feed.md).
- **Errors** are JSON, `{"error": "...", "code": "..."}`. Match on the status or the `code`, not on the text.

On an instance with a password, the `feeds` endpoints need `Authorization: Bearer <password>`. The `read` endpoints never do.

Every instance serves its own spec at `/api/v1/openapi.json`, generated from the server's route table, so it always matches the version you run. Point a code generator or an API client at it. The reference below is the spec of the latest release.

<swagger-ui src="api/openapi.json"/>
