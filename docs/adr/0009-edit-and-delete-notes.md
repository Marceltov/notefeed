---
status: accepted
date: 2026-10-01
decision-makers: Marcel Bruckner
---

# Edit and delete notes with the same access as posting, keeping the note's id

## Context and Problem Statement

A note could be posted but never changed or removed: a typo, a leaked secret or a stale status stayed until the operator edited files on disk. Issue #9 asks for it with only a title, "Edit, Delete notes", and no further detail. The decisions below were made on the owner's behalf while working on it, so each is stated with its reason, to be reviewed and overruled where the owner disagrees. Who may do it, what stays the same when a note is edited, and how does a browser without JavaScript do it? (Issue #9, building on ADR 0001, ADR 0005 and ADR 0008.)

## Decision Drivers

* No accounts: there is nobody to attribute a note to (ADR 0001).
* One write path for scripts, the web UI, the client packages and MCP (ADR 0005).
* A note's URLs and its RSS `guid` should not break because its text changed.
* Notes are plain `.md` files, stored exactly as sent.
* The web UI must keep working without JavaScript (ADR 0005).
* No new dependency, setting or storage.

## Considered Options

Who may edit and delete:

* **Whoever may post to the feed,** with the same checks.
* **Only the creator of a note,** by a token returned when it is posted.
* **A separate edit key** per feed or per note.

What an edit changes:

* **The content only;** the id, the URLs and the RSS `guid` stay.
* **A new id from the new title,** so the id always matches the title.

Whether to record the change:

* **Nothing:** no `updated_at`, no history.
* **An `updated_at` field** from the file's modification time, or a history of earlier versions.

Browsers without JavaScript:

* **POST-only form routes** next to the API's `PUT` and `DELETE`.
* **Method override** (`_method=PUT`) on the existing routes.
* **JavaScript only** for editing and deleting.

## Decision Outcome

Chosen options: the same access as posting, a stable id, no change record, and POST-only form routes for the web UI, because together they add the feature without accounts, tokens, new storage or a second write path.

* **Who may:** exactly whoever may post to the feed, through the same checks in the same order as a post: the instance password, then the feed's password (ADR 0008), then the per-client rate limit. On an open feed the name is the write key (ADR 0001), and that now covers destroying notes as well as adding them. This is the decision with the most weight and the one the owner is most likely to want to change. A feed password is the protection, and ADR 0008 already lets a feed owner add one when creating the feed. The read link stays read-only and can neither edit nor delete. A per-note token would need a place to store it and a way to hand it to the poster, and the web UI has no account to keep it in; a separate key would be a second credential to manage for what is already one secret per feed.
* **The id never changes.** A note's id is its time stamp plus a slug of its title when it was posted, and it is the note's file name, its page address and its RSS `guid`. An edit replaces the file's content and keeps the id, so links to the note and the item in feed readers stay valid. The title is worked out again from the new text, so the slug in an id can differ from the current title after an edit. That is accepted: a stale slug is cosmetic, a broken link is not. Renaming to a new id would break every URL to the note and make a feed reader show a duplicate.
* **No `updated_at`, no history.** Storage is one file per note, byte for byte (ADR 0001), and a file's modification time changes with backups and restores, so it can't serve as an edit time. A stored field would need a format that holds more than the note's text. The old text is not kept: an edit is final, and so is a delete. A real field or a history can be added later if someone needs it, and nothing here prevents it.
* **API:** `PUT /api/v1/feeds/{feed}/notes/{id}` (`editNote`, `200` with the note) and `DELETE` on the same path (`deleteNote`, `204`). The edit body has the same formats and the same checks as a post, size and UTF-8 included. A missing note is `404`; an invalid feed name is `400`; a protected feed answers `401` before it says anything about its notes. Neither request creates a feed. MCP gets `edit_note` and `delete_note`, the latter marked destructive, and both client packages get `edit` and `delete` and matching `notefeed edit` and `notefeed delete` commands.
* **One write path:** `backend/posting.ts` has `editNote` and `deleteNote` next to `postNote`, and the HTTP routes, the MCP tools and the web UI's form routes all call them (ADR 0005). Edits and deletes count against the same per-client post limit; the feed caps don't apply, since neither adds a note. An edit is written to a temporary file and renamed over the note, so a reader sees the old or the new text, never half of it.
* **The web UI:** the note page `/<feed>/<id>` gets an Edit control and a Delete control with a confirmation step. With JavaScript they call the API. Without it they are plain forms, and an HTML form can send only `GET` and `POST`, and a page can't share its path with a route handler, so they post to `POST /<feed>/<id>/edit` and `POST /<feed>/<id>/delete`, backend route handlers that call the same two functions and answer with a redirect. The edit form posts `multipart/form-data` like the compose box, because a urlencoded body is up to a third bigger for non-ASCII text and would hit the size cap early; a web-UI edit normalises nothing, so line endings are whatever the browser sends (CRLF from a plain form, LF from the JavaScript path). They accept only requests from the instance's own pages (the `Origin` check of ADR 0005 and ADR 0008), because they exist for this UI and scripts have the API. A method override on the page's own path was rejected because it would give the page's address a second, hidden meaning; making JavaScript required would drop the no-JavaScript promise of ADR 0005. The read-only view has neither control.
* **Empty feeds remain.** Deleting the last note leaves the feed's folder and its password. The feed is then empty, and the web UI shows what it shows for any feed without notes, except the password field for a new feed: an emptied feed still exists, so it still counts toward `NOTEFEED_MAX_FEEDS` and cannot be given a password. Deleting a feed, and giving it a new read id, is issue #40.

Out of scope: undo or a trash, edit history, bulk delete, and per-note permissions.

### Consequences

* Good, because every entry point shares one access check and one write path, so a bug or a fix shows up everywhere.
* Good, because a note's links and its RSS `guid` survive an edit.
* Good, because no new dependency, setting or storage, and an instance that never edits behaves as before.
* Bad, because anyone who knows the name of an open feed can now delete all of its notes, not only add to it. A feed password is the protection, and ADR 0008 only lets a feed get one when it is created; there is no backup or undo in notefeed.
* Bad, because a mistaken delete or edit can't be undone.
* Bad, because a feed reader that has already seen an item may not show its edited text, since the `guid` stays and a reader treats a known `guid` as unchanged. Some readers compare the content and some don't.
* Bad, because a note has no edit time and no history, so nobody can tell that a note was changed, or what it said before.
* Bad, because the slug in an id can disagree with the title after an edit.
* Bad, because the per-client rate limit now also covers edits and deletes, so a busy script that edits many notes shares its 60 a minute with its posts.

### Confirmation

Vitest covers replacing and deleting a note's file (the id stays, a missing note, no temporary file left), the order in the write path (access before the body is read, which the API tests check with a body stream that must stay unread, the rate limit, the `404`), the API operations on open and protected feeds (`401` without the password, `404` for a missing note or a malformed id, an empty or oversize edit refused with the note unchanged, the read API and the RSS `guid` after an edit), the form routes (same-origin only, redirects, errors), the MCP tools with and without a password, and both client packages and their commands. Playwright edits a note in the browser and sees the new text, deletes it and sees it gone, and checks that the read-only view has no controls.
