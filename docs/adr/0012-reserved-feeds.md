---
status: accepted
date: 2026-10-02
decision-makers: Marcel Bruckner
---

# Reserved feeds: operator-only, created at start-up, with their name as read id

## Context and Problem Statement

An instance needs feeds such as `news` or `announcements` that only the operator posts to, that people can subscribe to at a link that never changes and is easy to hand out, and whose names nobody else can take first. Issue #41. Feeds are otherwise created by their first post, open, with a random read id (ADR 0010). How do operator feeds come to exist, who may post to them, and what is their read id?

## Considered Options

* Block the names and let the operator create the folders by hand.
* Create them at start-up, protected by the instance password.
* Create them at start-up, protected by a separate reserved password, with their name as read id.

## Decision Outcome

Chosen option: "Create them at start-up with a separate reserved password and their name as read id", because the operator should not have to lock the whole instance to have operator-only feeds, and because announcement links are public by intent, so obfuscating them has no value.

* `NOTEFEED_RESERVED_FEEDS` lists the names. Nobody can create one by posting (`400`, `reserved_feed`). A feed that already had such a name keeps working.
* With `NOTEFEED_RESERVED_PASSWORD` set, each missing one is created at start-up as an ordinary protected feed (ADR 0008) with that password. Without it they don't exist.
* The read id is the name: `/r/news`. It is accepted next to the 22-character form (`isReadId` in `backend/feeds.ts`), so the link is the same after the feed is deleted and made again at the next start.

### Consequences

* Good, because the feature reuses feed passwords and the read-id index; no new storage or credential kind.
* Bad, because a reserved feed's read link reveals its name, and anyone can guess `/r/news`. Intended; do not list a name here that should stay secret.
* Bad, because the reserved password is only applied when a feed is created; changing the variable later changes nothing until the feed's own password is changed or the feed is deleted and re-created.
* Bad, because a reserved feed deleted at runtime stays gone until the next start.
