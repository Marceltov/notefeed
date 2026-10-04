---
status: accepted
date: 2026-10-04
decision-makers: Marcel Bruckner
---

# A storage interface, with the file system, SQLite and PostgreSQL behind it

## Context and Problem Statement

Everything was stored as files under `DATA_DIR` (ADR 0017, 0018). The hosted service is to run on a database, and the plans for licenses (#42) need transactions and indexed lookups that files cannot give. Issue #93 asks to make the storage backend a setting. All disk access was already in `backend/data/`, so the question was how to put a seam there, which backends to build first, and what to do about the things that only worked because of files: the in-memory feed index, the server secret and hand-placed files.

## Considered Options

* One `Storage` interface in terms of feeds and notes, with the file system, SQLite and PostgreSQL behind it (chosen).
* A switch inside each of the six data modules.
* A key-value interface (get and put by path) with the layout kept in the callers.
* The same three backends plus an S3-compatible object store in one go.

For the SQL backends:

* Kysely, one query definition for both dialects, with its migrator (chosen).
* Raw SQL with the two drivers, once per dialect.
* A heavier ORM or schema tool (Drizzle).

## Decision Outcome

Chosen option: the interface, in `backend/storage/types.ts`, with the file system (default, layout unchanged), SQLite and PostgreSQL behind it, chosen by `NOTEFEED_STORAGE`. The object store is left for later: it has no transactions and no rename, so it is its own design. The interface says what the code needs ("find the feed for this read id", "read a note by id and these extensions"), not file operations, and one contract suite (`backend/storage/contract.ts`) is run against every backend.

* **The database is the only source of truth.** A unique constraint guards read ids, counts are queries, a feed's notes go with it by a cascade. There is no in-memory index, so several containers stay consistent. The file system backend keeps its in-memory index (one process per `DATA_DIR`), now private to it.
* **Pictures are note content.** An image is a note (ADR 0019), so its bytes are a note's `content` column (`bytea`, `BLOB`). There is no separate image store.
* **One SQL implementation** on Kysely for both databases; only the migration's column types differ. JSON metadata and settings are plain text in both, since nothing queries inside them. Migrations are in code, run when notefeed starts, and a database made by a newer notefeed is refused.
* **The server secret is not stored.** It signs cookies and tokens and is read synchronously, so it cannot come from a database. `fs` keeps `NOTEFEED_SECRET` or `DATA_DIR/.secret`; `sqlite` and `postgres` require `NOTEFEED_SECRET` and refuse to start without it. Read ids derived from the secret (feeds from before random ones) exist only on `fs`.
* **Reading costs less on every backend** (#96): a feed's notes are listed once per request, a single note is found by trying the accepted extensions, the tag filter reads metadata only, and a folder, link or unreadable file in a feed folder is "not a note", never an error.
* **A write to a feed deleted meanwhile** is a `FeedGoneError` on every backend, so callers no longer look at `ENOENT`.
* **Migration between backends is not built.** There is no instance to move yet; a new instance on a database starts empty. A command can be added when one is needed.

### Consequences

* Good, because the hosted service can run on PostgreSQL, and the license work can use transactions and indexes.
* Good, because the contract suite pins the same guarantees on all backends: ids never overwritten, a note listed only with its metadata, no half note after a delete, a read id on one feed.
* Good, because the default is unchanged: the image, the compose file and the folder layout stay as they were.
* Bad, because there are two new runtime dependencies (`kysely`, `pg`) and one native one (`better-sqlite3`), which must stay in `serverExternalPackages` so the standalone build traces them. Kysely and `better-sqlite3` need Node 22, as the Docker image and CI already use.
* Bad, because the database backends cannot be edited by hand the way a folder can.
* Bad, because the `fs` backend and the SQL backends have different failure modes (a hand-removed folder against a lost connection), which the contract suite cannot fully cover.
