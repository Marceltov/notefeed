// The database backend: SQLite and PostgreSQL through Kysely, one implementation for both. The database is the only source of truth
// (no in-memory index): uniqueness is a constraint, counts are queries, so several containers stay consistent.
import { sql, type Kysely } from "kysely";
import { NotFoundError, ReadIdTakenError } from "../../errors";
import { logger } from "../../log";
import { noteFeedSize } from "../../metrics";
import { newKey, type ImageStore } from "../images/types";
import { applyPatch, hasMeta, parseMeta } from "../meta";
import { parseSettings, serializeSettings } from "../settings";
import { FeedGoneError, type Meta, type Storage } from "../types";
import { IMAGE_EXTS } from "../../../shared/images";
import { migrate, type Kind } from "./migrations";
import type { Schema } from "./schema";

export type SqlStorage = Storage & {
  close(): Promise<void>;
  /**
   * The operator's clean-up: the objects in the image store that no note names, and, with `remove`, their deletion. An object written
   * less than `olderThanMs` ago is left alone and only counted (`tooRecent`): its note's row may not be there yet. `missing` counts
   * the notes whose object is not in the store. null: this instance has no image store.
   */
  sweepImages(o: { remove: boolean; olderThanMs: number }): Promise<Sweep | null>;
  /**
   * The operator's move of image bytes into the configured store (issue #128): from the rows (`from` "db") or from another store, at
   * most `limit` notes per call, newest first, from behind the cursor `after` (the previous call's `next`); `left` says how many rows
   * are still to look at. Each note is moved whole and in a safe order (the new copy first, the row next, the old bytes last), so a run
   * can stop anywhere and start again. A note whose bytes are nowhere is counted as `missing` and left alone; one the store refused as
   * `failed`. Throws when `from` is the configured store itself (a probe object put into the target is found in the source), since the
   * move would delete what it moved.
   */
  moveImages(o: { from: ImageStore | "db"; limit: number; after?: string }): Promise<Move>;
};

/** `skipped`: rows that changed meanwhile or were moved by an earlier run. `next`: the cursor for the next call, null when nothing is left. */
export type Move = { moved: { count: number; bytes: number }; skipped: number; missing: number; failed: number; left: number; next: string | null };

// A cursor is "<created_at>:<id>" of the last row a call examined; anything else counts as the start.
function parseCursor(c: string): { at: number; id: string } | null {
  const m = /^(\d+):(.+)$/.exec(c);
  return m ? { at: Number(m[1]), id: m[2] } : null;
}

export type Sweep = { unreferenced: { count: number; bytes: number }; deleted: { count: number; bytes: number }; failed: number; tooRecent: number; missing: number };

/** Where the bytes of the notes with an `external` extension go, instead of the row. Without it, every note's bytes are in its row. */
export type Images = { store: ImageStore; external: (ext: string) => boolean };

const log = logger("storage");
const EMPTY = Buffer.alloc(0);

const NAME_RE = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9]{1,16})$/;
const code = (e: unknown) => String((e as { code?: unknown })?.code ?? "");
const isForeignKey = (e: unknown) => code(e) === "23503" || code(e) === "SQLITE_CONSTRAINT_FOREIGNKEY";
const isUnique = (e: unknown) => code(e) === "23505" || code(e) === "SQLITE_CONSTRAINT_UNIQUE" || code(e) === "SQLITE_CONSTRAINT_PRIMARYKEY";
const changed = (n: bigint | number | undefined) => Number(n ?? 0) > 0;
const bytes = (content: string | Uint8Array) => (typeof content === "string" ? Buffer.from(content) : Buffer.from(content));

// `kind` picks the dialect-specific migration; `connect` is called once, on first use.
export function createSqlStorage(connect: () => Promise<Kysely<Schema>>, kind: Kind = "sqlite", images?: Images): SqlStorage {
  let opened: Promise<Kysely<Schema>> | undefined;

  // After the row is gone (or never came to be), its object is only storage: a failure to remove it is logged, never the caller's error.
  // No feed or key in the line: a feed's name is its secret.
  const drop = async (keys: (string | null | undefined)[]) => {
    for (const key of keys) {
      if (!key || !images) continue;
      await images.store.delete(key).then(
        () => log.info("image deleted from the image store"),
        (err) => log.warn({ err }, "could not remove an image from the image store; it stays there unreferenced"),
      );
    }
  };
  // Never the key in the line: only that an object went in, and its size.
  const stored = async (key: string, data: Buffer) => {
    await images!.store.put(key, data);
    log.info({ bytes: data.byteLength }, "image stored in the image store");
  };
  // The bytes of a row: its own, or the object its key names. null when the object is gone.
  const bytesOf = async (row: { content: Buffer | Uint8Array; blob_key: string | null }): Promise<Buffer | null> => {
    if (row.blob_key === null) return Buffer.from(row.content);
    if (!images) {
      log.error("a note's image is in an image store, but NOTEFEED_IMAGES names none");
      return null;
    }
    const found = await images.store.get(row.blob_key);
    if (!found) log.error("a note's image is missing from the image store");
    return found;
  };

  function open(): Promise<Kysely<Schema>> {
    if (opened) return opened;
    const attempt = (async () => {
      let db: Kysely<Schema> | undefined;
      try {
        db = await connect();
        await migrate(db, kind);
        return db;
      } catch (e) {
        await db?.destroy().catch(() => {});
        const known = e instanceof Error && e.message.startsWith("the database was made by a newer notefeed");
        // No `cause`: the driver's error names the address or the file, and the log would carry it.
        throw known ? e : new Error(`cannot use the database named by NOTEFEED_DATABASE_URL (${code(e) || (e as Error)?.name || "error"})`);
      }
    })();
    opened = attempt;
    attempt.catch(() => opened === attempt && (opened = undefined)); // retry after a failure
    return attempt;
  }

  const metaOf = (raw: string | null): Meta => (raw ? parseMeta(raw) : {});
  // The extensions whose bytes belong in the image store, for the move's "rows still holding their bytes" query.
  const EXTERNAL_EXTS = () => (IMAGE_EXTS as readonly string[]).filter((e) => images?.external(e));

  return {
    // With an image store, the object is written first and the row second: a row never names bytes that are not there. If the row
    // does not come to be, the object is removed again.
    async writeNote(feed, base, ext, content, meta) {
      const db = await open();
      const now = Date.now();
      const data = bytes(content);
      const key = images?.external(ext) ? newKey() : null;
      if (key) await stored(key, data);
      try {
        for (let n = 1; ; n++) {
          const id = n === 1 ? base : `${base}-${n}`;
          const r = await db
            .insertInto("notes")
            .values({ feed, id, ext, content: key ? EMPTY : data, blob_key: key, size: data.byteLength, metadata: hasMeta(meta) ? JSON.stringify(meta) : null, created_at: now, updated_at: now })
            .onConflict((oc) => oc.columns(["feed", "id"]).doNothing())
            .executeTakeFirst();
          if (changed(r.numInsertedOrUpdatedRows)) return id;
        }
      } catch (e) {
        await drop([key]);
        if (isForeignKey(e)) throw new FeedGoneError();
        throw e;
      }
    },

    async listNoteRefs(feed) {
      const rows = await (await open()).selectFrom("notes").select(["id", "ext"]).where("feed", "=", feed).orderBy("created_at").orderBy("id").execute();
      noteFeedSize(rows.length);
      return rows;
    },

    async readNote(feed, id, exts, withContent) {
      if (exts.length === 0) return null;
      const db = await open();
      const row = await db
        .selectFrom("notes")
        .select(["ext", "metadata", "updated_at", "size"])
        .where("feed", "=", feed)
        .where("id", "=", id)
        .where("ext", "in", exts)
        .executeTakeFirst();
      if (!row) return null;
      let content: Buffer = EMPTY;
      if (withContent(row.ext)) {
        const full = await db.selectFrom("notes").select(["content", "blob_key"]).where("feed", "=", feed).where("id", "=", id).executeTakeFirst();
        const found = full && (await bytesOf(full));
        if (!found) return null; // deleted since the first read, or its object is gone
        content = found;
      }
      return { ext: row.ext, content, size: Number(row.size), meta: metaOf(row.metadata), mtime: new Date(Number(row.updated_at)) };
    },

    async readMeta(feed, ref) {
      const row = await (await open()).selectFrom("notes").select("metadata").where("feed", "=", feed).where("id", "=", ref.id).where("ext", "=", ref.ext).executeTakeFirst();
      return row ? metaOf(row.metadata) : null;
    },

    // A note that belongs in the image store gets a new object, then the row is pointed at it, then the old object goes: a reader
    // meets the old bytes or the new ones, never a key without an object. The update names the key it replaces, so of two
    // replacements at once each removes the object it took out of the row, and none is removed twice or left behind.
    async replaceNote(feed, id, exts, content) {
      if (exts.length === 0) return false;
      const db = await open();
      const data = bytes(content);
      let key: string | null = null;
      try {
        for (;;) {
          const row = await db.selectFrom("notes").select(["ext", "blob_key"]).where("feed", "=", feed).where("id", "=", id).where("ext", "in", exts).executeTakeFirst();
          if (!row) break;
          if (!key && images?.external(row.ext)) await stored((key = newKey()), data);
          const r = await db
            .updateTable("notes")
            .set({ content: key ? EMPTY : data, blob_key: key, size: data.byteLength, updated_at: Date.now() })
            .where("feed", "=", feed)
            .where("id", "=", id)
            .where("ext", "=", row.ext)
            .where("blob_key", row.blob_key === null ? "is" : "=", row.blob_key)
            .executeTakeFirst();
          if (!changed(r.numUpdatedRows)) continue; // replaced or deleted meanwhile: look again
          await drop([row.blob_key]);
          return true;
        }
      } catch (e) {
        await drop([key]);
        throw e;
      }
      await drop([key]);
      return false;
    },

    async updateMeta(feed, id, exts, patch) {
      if (exts.length === 0) return false;
      return (await open()).transaction().execute(async (tx) => {
        const row = await tx.selectFrom("notes").select(["ext", "metadata"]).where("feed", "=", feed).where("id", "=", id).where("ext", "in", exts).executeTakeFirst();
        if (!row) return false;
        const merged = applyPatch(metaOf(row.metadata), patch);
        await tx.updateTable("notes").set({ metadata: hasMeta(merged) ? JSON.stringify(merged) : null }).where("feed", "=", feed).where("id", "=", id).execute();
        return true;
      });
    },

    async deleteNote(feed, id, exts) {
      if (exts.length === 0) return false;
      const rows = await (await open()).deleteFrom("notes").where("feed", "=", feed).where("id", "=", id).where("ext", "in", exts).returning("blob_key").execute();
      await drop(rows.map((r) => r.blob_key)); // the row first: a crash in between leaves an object, never a note without its image
      return rows.length > 0;
    },

    async readFile(feed, name) {
      const m = NAME_RE.exec(name);
      if (!m) return null;
      const row = await (await open()).selectFrom("notes").select(["content", "blob_key"]).where("feed", "=", feed).where("id", "=", m[1]).where("ext", "=", m[2]).executeTakeFirst();
      return row ? bytesOf(row) : null;
    },

    async readSettings(feed) {
      const row = await (await open()).selectFrom("feeds").select("settings").where("name", "=", feed).executeTakeFirst();
      return parseSettings(row?.settings ?? null);
    },
    async writeSettings(feed, s) {
      const r = await (await open()).updateTable("feeds").set({ settings: serializeSettings(s) }).where("name", "=", feed).executeTakeFirst();
      if (!changed(r.numUpdatedRows)) throw new FeedGoneError();
    },
    async readHash(feed) {
      return (await (await open()).selectFrom("feeds").select("password_hash").where("name", "=", feed).executeTakeFirst())?.password_hash ?? null;
    },
    async writeHash(feed, hash) {
      const r = await (await open()).updateTable("feeds").set({ password_hash: hash }).where("name", "=", feed).executeTakeFirst();
      if (!changed(r.numUpdatedRows)) throw new FeedGoneError();
    },
    async removeHash(feed) {
      await (await open()).updateTable("feeds").set({ password_hash: null }).where("name", "=", feed).execute();
    },

    async createFeed(feed, readId, hash) {
      try {
        const r = await (await open())
          .insertInto("feeds")
          .values({ name: feed, read_id: readId, password_hash: hash ?? null, settings: null, created_at: Date.now() })
          .onConflict((oc) => oc.column("name").doNothing())
          .executeTakeFirst();
        return { created: changed(r.numInsertedOrUpdatedRows) };
      } catch (e) {
        if (isUnique(e)) throw new ReadIdTakenError(); // the name conflict is handled above, so this is the read id
        throw e;
      }
    },
    async deleteFeed(feed) {
      const db = await open();
      // The keys are read before the rows go with the feed (cascade). An image posted in between leaves its object unreferenced.
      const keys = await db.selectFrom("notes").select("blob_key").where("feed", "=", feed).where("blob_key", "is not", null).execute();
      const r = await db.deleteFrom("feeds").where("name", "=", feed).executeTakeFirst();
      if (!changed(r.numDeletedRows)) return false;
      await drop(keys.map((k) => k.blob_key));
      return true;
    },
    async forgetFeed() {
      // Nothing to drop: the rows are the truth, and a feed that is there is not "gone".
    },
    async setReadId(feed, readId) {
      try {
        const r = await (await open()).updateTable("feeds").set({ read_id: readId }).where("name", "=", feed).executeTakeFirst();
        if (!changed(r.numUpdatedRows)) throw new NotFoundError("no such feed");
      } catch (e) {
        if (isUnique(e)) throw new ReadIdTakenError();
        throw e;
      }
    },
    async feedReadId(feed) {
      return (await (await open()).selectFrom("feeds").select("read_id").where("name", "=", feed).executeTakeFirst())?.read_id;
    },
    async feedForReadId(readId) {
      return (await (await open()).selectFrom("feeds").select("name").where("read_id", "=", readId).executeTakeFirst())?.name ?? null;
    },
    async listFeeds() {
      return (await (await open()).selectFrom("feeds").select("name").orderBy("name").execute()).map((r) => r.name);
    },
    async listFeedNames() {
      return this.listFeeds();
    },
    async feedCount() {
      const r = await (await open()).selectFrom("feeds").select(sql<number | string>`count(*)`.as("n")).executeTakeFirstOrThrow();
      return Number(r.n);
    },

    // The store is listed first and the rows are read after it. An object old enough to count was written before its row, so a row
    // that names it is there by the time the rows are read; a note posted meanwhile has a young object, which is passed over.
    async sweepImages({ remove, olderThanMs }) {
      if (!images) return null;
      const db = await open();
      const started = Date.now();
      const old = new Map<string, number>();
      const inStore = new Set<string>();
      let tooRecent = 0;
      for await (const o of images.store.list()) {
        inStore.add(o.key);
        if (o.modified.getTime() <= started - olderThanMs) old.set(o.key, o.size);
        else tooRecent++;
      }
      const rows = await db.selectFrom("notes").select(["blob_key", "updated_at"]).where("blob_key", "is not", null).execute();
      let missing = 0;
      for (const row of rows) {
        old.delete(row.blob_key!);
        // A row written since the listing began names an object the listing may not have seen.
        if (!inStore.has(row.blob_key!) && Number(row.updated_at) < started) missing++;
      }
      const sweep: Sweep = { unreferenced: { count: old.size, bytes: [...old.values()].reduce((a, b) => a + b, 0) }, deleted: { count: 0, bytes: 0 }, failed: 0, tooRecent, missing };
      if (!remove) return sweep;
      for (const [key, size] of old) {
        try {
          await images.store.delete(key);
          sweep.deleted.count++;
          sweep.deleted.bytes += size;
        } catch (err) {
          sweep.failed++;
          log.warn({ err }, "could not remove an unreferenced image from the image store");
        }
      }
      log.info({ deleted: sweep.deleted.count, bytes: sweep.deleted.bytes, failed: sweep.failed }, "unreferenced images removed from the image store");
      return sweep;
    },

    // Nothing here changes a note's id, ext or metadata: the move is about where the bytes are, and a reader meets the old place or
    // the new one. Rows are walked newest first behind a cursor (`after`, the last row the previous call examined), so a call that
    // finds a row changed meanwhile (replaced, deleted, already moved) passes it over and the next call goes on behind it.
    async moveImages({ from, limit, after }) {
      const db = await open();
      const target = images?.store ?? null;
      if (from === "db" && !target) throw new Error("nothing to move: the images are in the database and NOTEFEED_IMAGES is db");
      if (from !== "db" && target) {
        // The same store under two names would delete what it moved: a probe written to the target must not show up in the source.
        const probe = newKey();
        await target.put(probe, Buffer.from("probe"));
        try {
          if (await from.get(probe)) throw new Error("nothing to move: the source is the configured store itself");
        } finally {
          await target.delete(probe).catch(() => {});
        }
      }
      const move: Move = { moved: { count: 0, bytes: 0 }, skipped: 0, missing: 0, failed: 0, left: 0, next: null };
      const cursor = after ? parseCursor(after) : null;
      const pending = (before: { at: number; id: string } | null) => {
        let q = from === "db" ? db.selectFrom("notes").where("blob_key", "is", null).where("ext", "in", EXTERNAL_EXTS()) : db.selectFrom("notes").where("blob_key", "is not", null);
        if (before) q = q.where((eb) => eb.or([eb("created_at", "<", before.at), eb.and([eb("created_at", "=", before.at), eb("id", "<", before.id)])]));
        return q;
      };
      const rows = await pending(cursor).select(["feed", "id", "blob_key", "content", "created_at"]).orderBy("created_at", "desc").orderBy("id", "desc").limit(limit).execute();
      for (const row of rows) {
        try {
          if (from === "db") {
            // Row to store: the object first, the row next; a row that is gone or already moved leaves the object to be removed again.
            const key = newKey();
            const data = Buffer.from(row.content);
            await stored(key, data);
            const r = await db.updateTable("notes").set({ content: EMPTY, blob_key: key }).where("feed", "=", row.feed).where("id", "=", row.id).where("blob_key", "is", null).executeTakeFirst();
            if (!changed(r.numUpdatedRows)) {
              await drop([key]);
              move.skipped++;
              continue;
            }
            move.moved.count++;
            move.moved.bytes += data.byteLength;
          } else {
            const key = row.blob_key!;
            const data = await from.get(key);
            if (!data) {
              // Store to store leaves the row as it is, so a row whose object is already in the target was moved by an earlier run.
              if (target && (await target.get(key))) move.skipped++;
              else move.missing++;
              continue;
            }
            if (target) {
              // Store to store, under the same key: the row needs no change, and a run stopped after the copy only copies again.
              await stored(key, data);
            } else {
              // Store to row: the bytes into the row, then the object goes.
              const r = await db.updateTable("notes").set({ content: data, blob_key: null }).where("feed", "=", row.feed).where("id", "=", row.id).where("blob_key", "=", key).executeTakeFirst();
              if (!changed(r.numUpdatedRows)) {
                move.skipped++;
                continue;
              }
            }
            await from.delete(key);
            move.moved.count++;
            move.moved.bytes += data.byteLength;
          }
        } catch (err) {
          move.failed++;
          log.warn({ err }, "an image could not be moved");
        }
      }
      if (rows.length === limit) {
        const last = rows[rows.length - 1];
        const at = { at: Number(last.created_at), id: last.id };
        const r = await pending(at).select(sql<number | string>`count(*)`.as("n")).executeTakeFirstOrThrow();
        move.left = Number(r.n);
        move.next = move.left > 0 ? `${at.at}:${at.id}` : null;
      }
      log.info({ moved: move.moved.count, bytes: move.moved.bytes, skipped: move.skipped, missing: move.missing, failed: move.failed, left: move.left }, "images moved to the configured store");
      return move;
    },

    async close() {
      if (!opened) return;
      const db = await opened.catch(() => undefined);
      opened = undefined;
      await db?.destroy();
    },
  };
}
