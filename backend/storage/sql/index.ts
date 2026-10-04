// The database backend: SQLite and PostgreSQL through Kysely, one implementation for both. The database is the only source of truth
// (no in-memory index): uniqueness is a constraint, counts are queries, so several containers stay consistent.
import { sql, type Kysely } from "kysely";
import { NotFoundError, ReadIdTakenError } from "../../errors";
import { noteFeedSize } from "../../metrics";
import { applyPatch, hasMeta, parseMeta } from "../meta";
import { parseSettings, serializeSettings } from "../settings";
import { FeedGoneError, type Meta, type Storage } from "../types";
import { migrate, type Kind } from "./migrations";
import type { Schema } from "./schema";

export type SqlStorage = Storage & { close(): Promise<void> };

const NAME_RE = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9]{1,16})$/;
const code = (e: unknown) => String((e as { code?: unknown })?.code ?? "");
const isForeignKey = (e: unknown) => code(e) === "23503" || code(e) === "SQLITE_CONSTRAINT_FOREIGNKEY";
const isUnique = (e: unknown) => code(e) === "23505" || code(e) === "SQLITE_CONSTRAINT_UNIQUE" || code(e) === "SQLITE_CONSTRAINT_PRIMARYKEY";
const changed = (n: bigint | number | undefined) => Number(n ?? 0) > 0;
const bytes = (content: string | Uint8Array) => (typeof content === "string" ? Buffer.from(content) : Buffer.from(content));

// `kind` picks the dialect-specific migration; `connect` is called once, on first use.
export function createSqlStorage(connect: () => Promise<Kysely<Schema>>, kind: Kind = "sqlite"): SqlStorage {
  let opened: Promise<Kysely<Schema>> | undefined;

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
        throw known ? e : new Error(`cannot use the database named by NOTEFEED_DATABASE_URL (${code(e) || (e as Error)?.name || "error"})`, { cause: e });
      }
    })();
    opened = attempt;
    attempt.catch(() => opened === attempt && (opened = undefined)); // retry after a failure
    return attempt;
  }

  const metaOf = (raw: string | null): Meta => (raw ? parseMeta(raw) : {});

  return {
    async writeNote(feed, base, ext, content, meta) {
      const db = await open();
      const now = Date.now();
      for (let n = 1; ; n++) {
        const id = n === 1 ? base : `${base}-${n}`;
        try {
          const r = await db
            .insertInto("notes")
            .values({ feed, id, ext, content: bytes(content), metadata: hasMeta(meta) ? JSON.stringify(meta) : null, created_at: now, updated_at: now })
            .onConflict((oc) => oc.columns(["feed", "id"]).doNothing())
            .executeTakeFirst();
          if (changed(r.numInsertedOrUpdatedRows)) return id;
        } catch (e) {
          if (isForeignKey(e)) throw new FeedGoneError();
          throw e;
        }
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
        .select(["ext", "metadata", "updated_at", sql<number | string>`octet_length(content)`.as("size")])
        .where("feed", "=", feed)
        .where("id", "=", id)
        .where("ext", "in", exts)
        .executeTakeFirst();
      if (!row) return null;
      let content = Buffer.alloc(0);
      if (withContent(row.ext)) {
        const full = await db.selectFrom("notes").select("content").where("feed", "=", feed).where("id", "=", id).executeTakeFirst();
        if (!full) return null; // deleted since the first read
        content = Buffer.from(full.content);
      }
      return { ext: row.ext, content, size: Number(row.size), meta: metaOf(row.metadata), mtime: new Date(Number(row.updated_at)) };
    },

    async readMeta(feed, ref) {
      const row = await (await open()).selectFrom("notes").select("metadata").where("feed", "=", feed).where("id", "=", ref.id).where("ext", "=", ref.ext).executeTakeFirst();
      return row ? metaOf(row.metadata) : null;
    },

    async replaceNote(feed, id, exts, content) {
      if (exts.length === 0) return false;
      const r = await (await open()).updateTable("notes").set({ content: bytes(content), updated_at: Date.now() }).where("feed", "=", feed).where("id", "=", id).where("ext", "in", exts).executeTakeFirst();
      return changed(r.numUpdatedRows);
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
      const r = await (await open()).deleteFrom("notes").where("feed", "=", feed).where("id", "=", id).where("ext", "in", exts).executeTakeFirst();
      return changed(r.numDeletedRows);
    },

    async readFile(feed, name) {
      const m = NAME_RE.exec(name);
      if (!m) return null;
      const row = await (await open()).selectFrom("notes").select("content").where("feed", "=", feed).where("id", "=", m[1]).where("ext", "=", m[2]).executeTakeFirst();
      return row ? Buffer.from(row.content) : null;
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
      const r = await (await open()).deleteFrom("feeds").where("name", "=", feed).executeTakeFirst(); // the notes go with it (cascade)
      return changed(r.numDeletedRows);
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

    async close() {
      if (!opened) return;
      const db = await opened.catch(() => undefined);
      opened = undefined;
      await db?.destroy();
    },
  };
}
