---
status: accepted
date: 2026-10-03
decision-makers: Marcel Bruckner
---

# A feed's files live in its folder and are served by one route; notes refer to them by name

## Context and Problem Statement

Choosing and changing a feed's read id (ADR 0016, issue #89) raised the question of what happens to the image URLs written into notes. They contained the read id (`/r/<read id>/images/<file>`), and the first idea was to rewrite the notes on a change. Notes are meant to become encrypted, which notefeed will not be able to read, so it must not edit their content. Images were also a special case: a separate `.images/` folder and a separate route, while later files of other types would need the same again. How are a feed's files stored and served, and what do notes refer to? (Amends ADR 0011 and ADR 0016.)

## Considered Options

* Rewrite the URLs in notes when the read id changes.
* Leave the notes alone, and let a change of read id break their image links.
* Store every file of a feed in the feed's folder, serve them all by one route under the read id, and let a note name its images by file name, resolved against the current read id; full URLs stay as written.

## Decision Outcome

Chosen option: the third. Nothing in a note has to change when the read id does, and there is one way to serve a file.

* **Storage.** An uploaded image is `<DATA_DIR>/<feed>/<hash>.<ext>`, next to the notes (`<id>.md`) and the dot files. The `.images/` folder is gone. Counting a feed's images counts the names that match the image pattern.
* **Serving.** `GET /r/<read id>/<file>` for a name with an extension; note ids have none, so `/r/<read id>/<note id>` is still the note page (a rewrite in `next.config.ts` sends names with an extension to the file route). The route checks the name against a strict pattern before any path is built, so dot files (`.password`, `.readid`), paths and notes (`.md`) are never served, and it keeps ADR 0011's rules: the format is decided by the bytes, an extension-to-type table, `nosniff`, a sandbox CSP and immutable caching. Another file type later is a line in the table and a check, not a new route.
* **Relative references.** The upload answers `markdown: ![](<file>)` and still `url` (absolute) for use outside notefeed. The web views show a note's image whose address has no scheme and no leading slash from `/r/<current read id>/`, so it follows a changed read id. A full URL is shown as written and is the user's to update. RSS readers have no base to resolve against, so the feed turns a note's relative image links into absolute ones when it is generated (the stored note is unchanged); the channel image is built from the file name and the current read id.
* **The title image** is stored as a file name and was already built from the current read id.
* **No migration.** There were no users and the data was test data, so existing `.images/` folders and old-style links are not supported.

### Consequences

* Good, because notefeed never edits a note's content, which an encrypted note needs.
* Good, because one route, one name check and one type table serve every file of a feed.
* Good, because a relative image link survives a read id change with no work.
* Bad, because a full URL in a note breaks when the read id changes, and raw markdown read outside notefeed (the API's `markdown` field, the files on disk) shows a relative image as a broken one (the upload's `url` is for that).
* Bad, because a name with an extension and a note id share `/r/<read id>/`; a note id must never contain a dot, which the id format guarantees.
* Bad, because the feed folder now holds more kinds of files, so every listing of it must filter (notes by `.md`, images by the image pattern).
