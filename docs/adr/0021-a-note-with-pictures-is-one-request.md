---
status: accepted
date: 2026-10-03
decision-makers: Marcel Bruckner
---

# A note with pictures is one request: multipart on POST and PUT

## Context and Problem Statement

ADR 0020 left the work of a note with pictures to the caller: N+1 requests, pictures first, the references swapped in the text by each client. That showed four problems. N+1 requests count N+1 times against the rate limit. The swap lived in three places (shared, JS, Python), each a regex, and none of them knew titles (`![](a.png "t")`), reference definitions (`[l]: a.png`) or code blocks, so they swapped what they should not and missed what they should. A failure half-way left pictures in the feed with no text (the clients reported them as `posted`). And a picture's file name had to be letters, digits, `.`, `_` and `-` because of the regex. Issue #100 asks for one request with the right swap.

## Considered Options

* A header that maps names to files, with the pictures uploaded in separate requests: still N+1 requests, still not atomic.
* A `multipart/form-data` request that carries the text and the pictures, and the server does the swap.
* Keep it in the clients and fix the three regexes.

## Decision Outcome

Chosen option: the second. One request is the only way to be atomic and to count once against the rate limit, and one swap on the server replaces three copies.

* **Request.** `POST /api/v1/feeds/{feed}/notes` (and `POST /{feed}`) and `PUT /api/v1/feeds/{feed}/notes/{id}` of a markdown note also accept `multipart/form-data`: at most one `text` part (markdown; required on `PUT`), 0 to 10 `file` parts (the file name is the name the markdown refers to) and optional `alt.<filename>` fields. At least one text or file part. `X-Note-Alt` and `X-Note-Name` are `400` with multipart.
* **Text as a file part.** The text may be a plain string field or a file part. A file part is stored byte for byte, and clients send it so, because `FormData` rewrites `\n` to `\r\n` in string fields. Its type may be `text/markdown`, empty or `application/octet-stream` (what curl labels a `.md`).
* **File names.** Any single path segment of 1 to 200 UTF-16 units, without `/`, `\`, control characters (C0, U+007F, C1), text-direction override characters (U+202A to U+202E, U+2066 to U+2069), leading or trailing space, not only dots, unique. The server is the one definition of this rule: the clients check only duplicates, types and that the note is markdown, and a name the server refuses comes back as its `400`. A `"` in a file name round-trips: clients send it as `%22` and the server decodes it. So a literal `%22`, `%0A` or `%0D` in a file name is decoded too: `a%22b.png` is stored as `a"b.png`, and a name with `%0A` or `%0D` arrives with a line break and is refused as not a file name (`400`), which is an accepted edge.
* **The swap.** The server swaps `![](name)` (image destinations and `[l]: name` definitions, titles kept, `<name with spaces>` and percent-encoded `name%20x`; an exact match beats a decoded one; images in code blocks and spans are left alone; of a repeated label only the first definition, the one markdown uses, counts) and appends a picture the text never refers to as `![](file)`.
* **Atomic.** Everything is validated first, then the pictures are stored, then the text. A later failure removes what was stored (a feed this request created stays, even a protected one). A refusal names the part: `attachment "b.png": ...`. One rate-limit slot.
* **Answers.** `201` with the `Created` of the text note (of the first picture when there is no text part) plus `attachments`; `PUT` answers `200` with the note plus `attachments`. A raw request is unchanged.
* **One parser.** The web UI, the clients and the CLIs send this request; MCP `post_note` calls the same server function in-process. The three client regexes are gone.
* **Compatibility.** A 0.9.0 client needs a 0.9.0 server: an older server answers `415` to multipart. The `attachment` and `posted` error fields of 0.8.0 are removed, because nothing is posted on a refusal.

### Consequences

* Good, because one swap, on the server, gets titles, definitions, percent-encoded names and code blocks right.
* Good, because a note with pictures is one request, one rate-limit slot, and all or nothing.
* Good, because any file name works, not only letters, digits, `.`, `_` and `-`.
* Bad, because ADR 0019's one raw file per request now has an exception.
* Bad, because a 0.9.0 client does not work against an older server.
* Bad, because the request is read into memory up to its cap (the markdown limit plus 10 times `NOTEFEED_MAX_IMAGE_BYTES` plus 64 KiB).
* Bad, because a text of exactly the markdown limit cannot be stored with pictures: the swapped file names make the stored text longer.
