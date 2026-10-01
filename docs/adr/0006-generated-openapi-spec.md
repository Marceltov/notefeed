---
status: accepted
date: 2026-10-01
decision-makers: Marcel Bruckner
---

# Code-first REST API: the server generates its OpenAPI description

## Context and Problem Statement

notefeed stays one Next.js app. Other clients, apps and integrations use a stable, documented HTTP API instead of a separate backend. The API needs one source of truth, from which the documentation and the client packages (JS, Python) follow without drift. Should the source be a hand-written OpenAPI file or the server's code? (Issue #31.)

## Decision Drivers

* The description must always match what the running server does.
* Changing the API should be one edit in one place, and visible in review.
* The server must not depend on generated code or a generator toolchain to build.
* Few new dependencies.

## Considered Options

* **Spec-first:** a hand-written `openapi.yaml`, from which the server's types, validators and router (and the clients) are generated.
* **A hand-written spec checked by tests:** the server is written freely, and a test compares its responses with the spec.
* **Code-first without typed replies:** a route table generates the spec, but handlers build any `Response` they like. This was PR #32's first version.
* **Code-first with typed replies:** the route table generates the spec, and every handler is bound to the responses its entry declares.

## Decision Outcome

Chosen option: "Code-first with typed replies".
* **The one source:** the route table in `backend/http/api.ts`.
* **No generated server code:** the server never runs or ships generated code, and needs no generator to build.
* **The description is a reliable product of the code:** drift is prevented at three levels, so what the table says is what the server does.

**The route table:**
* Each entry is declared with `op({...}).handle(fn)` (`backend/http/dispatch.ts`). It holds the method and path, zod schemas for path, query and body, and its responses (status → description, optional schema, headers).
* The handler returns `{status, body, headers?}`, typed as the union of the entry's declared responses. Returning an undeclared status, or a body that doesn't match the declared schema's type, doesn't compile.
* Two calls are needed: in a single call, TypeScript widens the literal statuses before it knows the declared ones.

**The dispatcher** (`app/api/v1/[...path]` → `dispatch`, which `POST /<feed>` is also rewritten to):
* routes through the table, with JSON 404/405 for anything not in it
* parses query parameters with the entry's schema (400 `invalid_request`)
* maps thrown domain errors to their status and `{error, code}` body
* never sends a status the entry doesn't declare (logged 500)
* outside production, checks every body against its declared schema, so the test suite verifies formats and patterns that types can't

**The description:**
* `openApiDocument()` builds OpenAPI 3.1 from the table. Named zod schemas become components through `z.toJSONSchema`. OpenAPI 3.1 is JSON Schema 2020-12, so no translation library is needed.
* Each instance serves it at `/api/v1/openapi.json` with its own URL.
* `npm run generate` writes the committed `openapi.json`, so every API change shows up as a reviewable diff of the description.
* CI fails when the committed copy is stale, and lints it with Redocly.
* The client packages and the web UI's browser code are generated from this file (issue to follow).

### Consequences

* Good, because changing the API is one edit to the table: the description, documentation and (later) clients follow, and the compiler and the dispatcher keep the handlers honest.
* Good, because the server has no generated code and no build-time generator. Generation is only for consumers outside the server.
* Good, because only `zod` is added at runtime, and it was already in the lockfile.
* Bad, because zod's JSON Schema output decides some details of the description. It has to pass Redocly, which it does with one finding ignored: the spec endpoint has no 4xx response.
* Bad, because the reply typing relies on TypeScript inference: const type parameters, the curried `op()`, and a loose `AnyOp` type for the dispatcher's list. If that ever breaks, explicit generic arguments per entry work, and the dispatcher's runtime check stays in place either way.
* Spec-first was rejected after a design round. It would have meant two sources: a YAML file for the API and TypeScript for everything the pages call in-process (ADR 0003). The server would also have depended on generated code and a generator toolchain to build.
