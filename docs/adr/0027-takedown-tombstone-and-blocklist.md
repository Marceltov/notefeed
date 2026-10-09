---
status: accepted
date: 2026-10-09
decision-makers: Marcel Bruckner
---

# The operator's takedown: a tombstone for the feed, a blocklist for its images

## Context and Problem Statement

A feed can be deleted only by whoever knows its name (ADR 0001, ADR 0010). When illegal content is reported, the report carries a read link or an image URL (the report link, issue #154), the operator must remove it at once, and the same content must not come back under a new feed. notefeed stores nothing about anyone (ADR 0014), so removal is the only answer it can give; attribution is not one. Issue #155, decided in the security review of 2026-10-09. What does the operator's command do, what does it leave behind, and on which backends?

## Considered Options

* **A command that removes the feed and leaves a tombstone and a blocklist** (chosen): the feed's name and read id are held for good, the hashes of its images are refused everywhere.
* **Plain deletion by the operator:** the feed goes as if its owner had deleted it; the name and the read id are free again, the content can be posted again.
* **Hiding instead of deleting:** the feed stays stored, marked hidden, as evidence.

For where the command lives:

* **An operator endpoint,** `POST /api/operator/takedown`, behind `NOTEFEED_OPERATOR_TOKEN` like the image clean-up (issue #127). Chosen.
* A CLI inside the container.

## Decision Outcome

Chosen: the endpoint, with the tombstone and the blocklist, on every backend.

* **Addressed by what a report carries.** The target is a read link, a bare read id or an image URL; the read id in it names the feed. The operator never needs the feed's name, and the answer and the log never say it (ADR 0015).
* **The tombstone first.** The storage records the name and the read id before anything is deleted, so from that moment the feed is found by neither identifier: the pages, the RSS feed and the file route answer *removed by the operator* (`410`), a post to the name is `410` (`removed`), and `createFeed` and `setReadId` refuse the name (`removed`) and the id (`taken`) for good. A crash after the tombstone leaves a feed that nobody can reach and the next takedown (or, on the file system, the next start) removes.
* **Then the content,** rows and image store objects alike (`deleteFeed`'s order: the rows first, the objects last); the objects' keys are in the answer, for the operator's purge of backups, which is a procedure outside notefeed.
* **Then the blocklist:** the SHA-256 of every image's bytes, read before the deletion. Posting checks every image against it, as an image note, a replaced picture or a picture sent with a text, and answers `451` (`blocked`). A hash of the exact bytes is a narrow net on purpose: a re-encoded picture passes, and notefeed does no image processing (ADR 0011 (h)); it stops the simplest case, the same file again, at no cost to anyone else.
* **Part of the data.** Tombstones and the blocklist are tables in the database backends (migration `003_takedown`) and the files `.tombstones` and `.blocklist` in `DATA_DIR` on the file system backend (JSON lines and one hash per line, appended to, read with the feed index), so a backup restores them and a restore cannot quietly bring a removed name back. A restore from before the takedown brings the content back, which is why the takedown is repeatable and the file system backend removes a tombstoned feed's folder again when it starts.
* **Every backend.** The file system backend is not left out: a self-hosted open instance gets reports too, and the index it keeps anyway holds the two sets.
* **Not built:** hiding as evidence (what must be preserved for whom is a legal question first, recorded by the operator), a takedown of one note (the feed is the unit a report can name without the name), and anything that identifies a poster.

### Consequences

* Good, because a report can be acted on in one request, without reading the database by hand, and the content cannot come back under a new feed or in another one as the same file.
* Good, because nothing about the reporter or the poster is stored, and the log stays free of the feed's name.
* Bad, because a tombstoned name and read id are gone for every future user of the instance, including the operator, and nothing lists them.
* Bad, because the blocklist catches only the same bytes; a changed pixel passes.
* Bad, because the takedown is final: there is no undo but a backup, and the procedure for backups after a takedown is the operator's.
* Bad, because the file system backend's two files are append-only and never shrink; a few lines per takedown, so it does not matter in practice.
