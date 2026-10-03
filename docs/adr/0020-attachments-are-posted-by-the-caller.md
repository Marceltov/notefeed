---
status: accepted
date: 2026-10-03
decision-makers: Marcel Bruckner
---

# A note with pictures is posted by the caller: pictures first, then the text

## Context and Problem Statement

Since ADR 0019 a picture is a note of its own, so a script that wants a markdown note with its images posts N+1 notes and writes the `![](file)` references by hand. Issue #92 asks for one call in the clients, the CLIs and MCP.

## Considered Options

* A server request that takes the text and its files together (multipart or a bundle format).
* The caller does it: upload each picture as an image note, swap the references in the text, post the text last.

## Decision Outcome

Chosen option: the second. The API stays one raw body per note (ADR 0019), so there is no new request shape to version, document or secure.

* **Where it lives.** `attachments` on `post()` in both client packages, `--attach PATH` on `notefeed post`, and `attachments` on the MCP `post_note` tool, where the server does the same steps in-process. The reference swap is `placeImages` in `shared/links.ts` (the web compose box's `substitute` moved there); each client package carries its own copy.
* **References.** `![](name)` in the text refers to the attachment of that name; one the text never refers to is appended as `![](file)`. Names are letters, digits, `.`, `_` and `-`, unique, and not only dots.
* **Checked first.** Names, types and, in MCP, sizes are checked before the first request.
* **Failure.** Uploads are sequential and not rolled back. A failed upload raises the original error with the attachment's name and the pictures already posted; the text is not posted. A failed text post carries the posted pictures too.

### Consequences

* Good, because no server API change: older servers work with the new clients.
* Bad, because the posts are not atomic: a failure leaves the pictures already posted in the feed as notes of their own.
* Bad, because N+1 requests count N+1 times against the rate limit.
* Bad, because the swap logic exists in three places (shared, JS, Python); issue #100 (titled references) has to change all of them.
