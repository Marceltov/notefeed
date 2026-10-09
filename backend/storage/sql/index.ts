// The database backend: SQLite and PostgreSQL through Kysely, one implementation for both. The database is the only source of truth
// (no in-memory index): uniqueness is a constraint, counts are queries, so several containers stay consistent.
import { sql, type Kysely } from "kysely";
import { NotFoundError, ReadIdTakenError, RemovedFeedError } from "../../errors";
import { logger } from "../../log";
import { noteFeedSize } from "../../metrics";
import { newKey, type ImageStore } from "../images/types";
import { applyPatch, hasMeta, parseMeta } from "../meta";
import { parseSettings, serializeSettings } from "../settings";
import { FeedGoneError, type Meta, type Storage } from "../types";
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
};

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

// A name or a read id of a removed feed may not come back (issue #155).
async function refuseRemoved(db: Kysely<Schema>, feed: string | undefined, readId: string): Promise<void> {
  if (feed !== undefined && (await db.selectFrom("tombstones").select("name").where("name", "=", feed).executeTakeFirst())) throw new RemovedFeedError();
  if (await db.selectFrom("tombstones").select("name").where("read_id", "=", readId).executeTakeFirst()) throw new ReadIdTakenError();
}

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
      await refuseRemoved(await open(), feed, readId);
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
      await refuseRemoved(await open(), undefined, readId);
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

    // The tombstone goes in first, in its own statement, so a crash after it leaves a feed that is found by neither identifier
    // and removed by the next run; the rows go with the feed (cascade), the objects last, as in deleteFeed.
    async takedownFeed(feed, readId) {
      const db = await open();
      const id = readId ?? (await db.selectFrom("feeds").select("read_id").where("name", "=", feed).executeTakeFirst())?.read_id ?? null;
      await db.insertInto("tombstones").values({ name: feed, read_id: id, removed_at: Date.now() }).onConflict((oc) => oc.column("name").doNothing()).execute();
      const keys = (await db.selectFrom("notes").select("blob_key").where("feed", "=", feed).where("blob_key", "is not", null).execute()).map((k) => k.blob_key!);
      const r = await db.deleteFrom("feeds").where("name", "=", feed).executeTakeFirst();
      if (!changed(r.numDeletedRows)) return { removed: false, keys: [] };
      await drop(keys);
      return { removed: true, keys };
    },
    async isRemoved({ feed, readId }) {
      const db = await open();
      if (feed !== undefined && (await db.selectFrom("tombstones").select("name").where("name", "=", feed).executeTakeFirst())) return true;
      if (readId !== undefined && (await db.selectFrom("tombstones").select("name").where("read_id", "=", readId).executeTakeFirst())) return true;
      return false;
    },
    async blockImages(hashes) {
      if (hashes.length === 0) return;
      const now = Date.now();
      await (await open()).insertInto("blocked_images").values(hashes.map((hash) => ({ hash, added_at: now }))).onConflict((oc) => oc.column("hash").doNothing()).execute();
    },
    async isBlockedImage(hash) {
      return !!(await (await open()).selectFrom("blocked_images").select("hash").where("hash", "=", hash).executeTakeFirst());
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

    async close() {
      if (!opened) return;
      const db = await opened.catch(() => undefined);
      opened = undefined;
      await db?.destroy();
    },
  };
}
