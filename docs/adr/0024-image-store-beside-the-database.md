---
status: accepted
date: 2026-10-05
decision-makers: Marcel Bruckner
---

# Image bytes in an image store beside the database; no storage backend on S3 alone

## Context and Problem Statement

ADR 0023 put a storage interface in front of the file system, SQLite and PostgreSQL, kept image bytes in the note's row, and left the S3-compatible object store of issue #93 for later. The hosted service is to run as several stateless containers on one PostgreSQL. Feeds, text notes and metadata stay small at any size; image bytes are what grows. In the database they inflate dumps and replication and are loaded whole by the driver. In a local folder they cannot be reached from every container. The question was what the object store is for: a fourth storage backend holding everything, or a place for image bytes only.

## Considered Options

* An image store under the database backends: `db` (the row, as before), `fs` (a folder), `s3` (an S3-compatible object store), chosen by `NOTEFEED_IMAGES` (chosen).
* A fourth storage backend, `NOTEFEED_STORAGE=s3`, with every feed and note as objects.
* Both.

For serving an image from the object store:

* Through notefeed, as before (chosen).
* A redirect to a short-lived signed URL of the store.

For talking to the store:

* Signed `fetch` requests with a small signer, `aws4fetch` (chosen).
* The AWS SDK.

## Decision Outcome

Chosen option: an image store beside the database. The database stays the only source of truth: a note's row holds everything about an image except its bytes, and for those a random key into the store. Text notes always stay in their row.

* **No storage backend on S3 alone.** It fits no instance: a single container has a volume, a self-hosted instance with more than that has a database, and the hosted service needs the database anyway, because licenses (#42) need transactions and indexed lookups. On objects alone, listing a feed is a paged prefix list plus a request per note, counts mean listing everything, and deleting a feed or changing a read id is several requests that can stop half way.
* **Three operations.** The store puts, gets and deletes one object. Keys are random, so no request needs conditional writes, listing or renames, which are the features that differ between S3-compatible stores. (Since issue #127 the operator's clean-up lists the store, a plain paged `ListObjectsV2`; nothing else does.) No provider is named in code or settings, and the endpoint is required.
* **The object first, the row second; the row first, the object second.** A post writes the object and then the row; a deletion removes the row and then the object. A stop in between leaves an object no row refers to, never a note without its image. Such objects are unreachable; the operator's endpoint (issue #127) finds and removes them.
* **Keys say nothing.** A key holds no feed name and no note id: a feed's name is its secret (ADR 0001), and a feed made anew can never meet an old object.
* **Served through notefeed.** The read id and the feed password stay the only capabilities, URLs do not change, and the bucket stays private. A signed URL would work for anyone until it expired and would put expiring links into RSS readers and link previews.
* **A row has its bytes or a key.** So an instance can go from `db` to `fs` or `s3` without moving anything: old images stay in the database. `content` stays `NOT NULL` and is empty for a row with a key, because SQLite cannot drop the constraint without rebuilding the table; a `size` column holds the size wherever the bytes are.
* **The file system backend is unchanged.** There an image is a file in the feed's folder (ADR 0017).

### Consequences

* Good, because several containers can share one database and one bucket, and the database stays small.
* Good, because any S3-compatible store works, hosted or self-run, and the folder variant came from the same seam.
* Good, because one contract suite runs on every combination, in CI against a real S3-compatible server that checks the request signatures.
* Bad, because an image is now in two places that are written one after the other: unreferenced objects can be left behind, and a backup is two things.
* Bad, because image traffic still passes through notefeed, and an image is held in memory for the length of a request (bounded by `NOTEFEED_MAX_IMAGE_BYTES`).
* Bad, because moving images between stores is not built: only `db` to `fs` or `s3` works without it.
