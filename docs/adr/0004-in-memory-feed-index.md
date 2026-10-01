---
status: accepted
date: 2026-10-01
decision-makers: Marcel Bruckner
---

# An in-memory index of feeds

## Context and Problem Statement

A read id is an HMAC of the feed name and can't be reversed. To serve `/r/<readId>`, notefeed listed every feed folder and computed one HMAC per feed, on every request to a read page or RSS feed. RSS readers poll, and without `NOTEFEED_MAX_FEEDS` the number of feeds is unbounded, so the cost of each read grew with the size of the instance. The caps had the same problem: counting feeds meant listing every folder on each post. How should a feed be found from its read id?

## Decision Drivers

* Read ids and their 22-character format must not change: they are in readers' configs.
* No database: the data folder stays plain files.
* Unknown read ids must stay indistinguishable from empty feeds.

## Considered Options

* Keep scanning: list folders and compute every HMAC per request.
* An in-memory map from read id to feed name, built from the data folder once and updated when a note creates a feed.
* Reversible read ids (encrypt the name instead of hashing it).
* An index file on disk.

## Decision Outcome

Chosen option: "an in-memory map", because it makes lookups, existence checks and the feed count O(1) and keeps every existing read link.

* `backend/feeds.ts` builds the map on first use from the feed folders and keeps it in process-wide state (`backend/state.ts`, on `globalThis`), because Next may load a module once per route bundle. `createNote` is the only code that creates feeds, and it adds each new one.
* The map is keyed by `DATA_DIR`, so tests that switch folders get a fresh one.
* Notes themselves are always read from disk, so deleting a note or a feed folder takes effect at once.
* Reversible ids were rejected: they would change every read link, and their length would reveal the length of the name. An index file was rejected as a second source of truth that can drift from the folders.

### Consequences

* Good, because read pages and RSS polls cost a map lookup instead of a folder scan plus one HMAC per feed.
* Good, because `NOTEFEED_MAX_FEEDS` counts feeds without listing folders.
* Bad, because feed folders added or removed by hand (for example, a restore from backup) are only seen after a restart. A deleted feed keeps counting toward `NOTEFEED_MAX_FEEDS` until then. Both are documented in operations.md.
* Bad, because it assumes one process per data folder, which is how notefeed ships (one container).
* Neutral: the scan compared ids in constant time. A map lookup's timing depends on the id's hash, not on how much of a real id matches, so it reveals nothing useful about valid ids.

### Confirmation

`backend/feeds.test.ts` covers lookups for feeds created through `createNote` and for feeds already on disk before the index was built. A check against the production build showed that a read page which built the index first still finds a feed created afterwards through the API.
