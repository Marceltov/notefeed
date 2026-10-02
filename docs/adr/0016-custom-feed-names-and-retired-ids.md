---
status: accepted
date: 2026-10-02
decision-makers: Marcel Bruckner
---

# Custom feed names and read ids, with retired ones answering 404

## Context and Problem Statement

A feed's name and read id are random by default and could not be changed (ADR 0001, ADR 0010). People want to choose what to call both, for example a readable read link. Issue #75. A name or read id that is only forgotten would let a script that still posts to the old name quietly create a new feed under it, and let the old read id reach another feed. What happens to the old ones, and how can an operator stop this?

## Considered Options

* Forget the old name and read id when they change.
* Retire them: keep a record, refuse to create or assign them again and answer 404 for them everywhere.
* Alias the old ones to the new ones.

## Decision Outcome

Chosen option: "Retire them", because forgetting reopens the silent-new-feed hole, and an alias keeps an old capability alive that the owner may have wanted to revoke.

* `PUT /api/v1/feeds/{feed}` (and the settings page, the MCP `update_feed` tool and the client packages) take `name` and `read_id`. A name keeps the rule `^[a-z0-9_-]{1,64}$`, a chosen read id is `^[a-z0-9_-]{3,64}$`; `read_id: ""` asks for a random one. A name or read id that is another feed's, retired, a route name or a reserved feed's is refused with `409` (`taken`).
* A rename moves the feed's directory (notes, images, settings, password) and keeps the read id; a legacy feed's derived read id is written to `.readid` first. A read id change rewrites `.readid`. The unlock cookie is per feed name, so browsers are signed out; the web UI form sets the new cookie for the browser that renamed.
* The old name (`name:<x>`) and old read id (`id:<x>`) are appended to `DATA_DIR/.retired`, loaded with the index. Posting, reading, RSS, the API, images and the pages answer `404` for them. The operator frees one by deleting its line and restarting.
* `NOTEFEED_ALLOW_CUSTOM_IDS=0` turns choosing off: only a random read id may be asked for.
* Reserved feeds keep their name and read id (read id = name, ADR 0012).
* A change counts against the post rate limit, like other settings writes.

### Consequences

* Good, because a retired read id can never reach another feed, and a stale script gets a `404` instead of a new feed.
* Bad, because a short readable name or read id is guessable, and on an open feed both are capabilities. The settings page and the docs say so.
* Bad, because a retired read id answers `404` while one that never existed answers an empty feed, so a visitor can tell it once existed. A retired id is no longer a capability, so this is accepted.
* Bad, because images embedded in notes use the read id in their URL; they stop loading after a read id change.
* Bad (ponytail): a feed cannot take its own retired name back, there is no per-feed lock (two changes at once: the second finds the directory gone and answers `404`), and a crash between the directory move and the record leaves the old name free. Add a record of who retired what, and a lock, if any of this matters.
* Bad, because there is no `NOTEFEED_MIN_ID_LENGTH`; the minimum is 3.
