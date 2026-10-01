---
status: accepted
date: 2026-10-01
decision-makers: Marcel Bruckner
---

# A versioned REST API whose OpenAPI spec is generated from the route table

## Context and Problem Statement

notefeed stays one Next.js app. Other clients, apps and integrations are served through a stable HTTP API, not a separate backend. Until now the API was `POST /<feed>` plus RSS, documented by hand in posting.md, and there was no way to read notes as JSON. How should the API be defined and documented so that the spec can't drift from what the server does? (Issue #31.)

## Decision Drivers

* The spec must match the running server, always.
* No hand-maintained second description of each endpoint.
* Few new dependencies, nothing heavy at runtime.

## Considered Options

* A hand-written `openapi.yaml`, checked against handler responses by a test.
* An OpenAPI library on top of zod (`zod-openapi`, `@asteasolutions/zod-to-openapi`).
* One route table with zod schemas; the dispatcher and the spec are both derived from it, using zod 4's built-in JSON Schema output.

## Decision Outcome

Chosen option: "one route table", because it makes drift impossible by construction and only needs `zod`.

* **The table:** `backend/http/api.ts` holds a table of operations for `/api/v1`. Each entry has a method, a path template, a summary, path and query schemas, request-body schemas per content type, responses per status (with schemas), and a handler.
* **Dispatch:** `app/api/v1/[...path]/route.ts` sends every request through the table. A route that isn't in the table is a 404, and a method that isn't is a 405. `POST /<feed>` is rewritten into it by `proxy.ts`.
* **The spec:** `openApiDocument()` builds OpenAPI 3.1 from the table. Named schemas (`Note`, `NoteList`, `Created`, `Error`, …) become components through `z.toJSONSchema` on a registry. OpenAPI 3.1 is JSON Schema 2020-12, so no translation layer is needed. Each instance serves its spec at `/api/v1/openapi.json`, with its own public URL.
* **Contract test:** `backend/http/api.test.ts` routes every call through a check that the status is declared for that operation and that the body parses with the declared schema. Query parameters are parsed with the same zod schemas the spec documents.
* **The docs copy:** `docs/api/openapi.json` is the generated spec for docs.notefeed.me, rendered with `mkdocs-swagger-ui-tag`. A test fails when it's out of date; `UPDATE_OPENAPI=1` regenerates it.
* **Versioning:** a breaking change gets `/api/v2`. `POST /<feed>` stays as the short form of `POST /api/v1/feeds/{feed}/notes`.

### Consequences

* Good, because adding an endpoint means adding a table entry, and the spec, routing and contract test follow.
* Good, because clients get JSON reads with cursor paging (`limit`, `before` → `next`), by name and by read id. The read-id endpoints never return the name.
* Bad, because the dispatcher is our own small path matcher instead of Next's file routes, at least for `/api/v1`.
* Bad, because zod's JSON Schema output decides some details of the spec (e.g. long `date-time` patterns). This is acceptable as long as an independent linter (`redocly lint`) passes, which it did when this was written, with only one style warning left.
