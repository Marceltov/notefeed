// Schema changes, in order. Never edit one that has shipped; add the next. Kept in code, not files, so the standalone build has
// nothing extra to trace. Kysely's Migrator records what ran in `kysely_migration` (and, for PostgreSQL, holds a lock while it
// runs, so two containers starting together migrate once).
// The migrations run against whatever the schema was when they were written, so the database is untyped here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Kysely, sql } from "kysely";
import { Migrator, type Migration } from "kysely/migration";

export type Kind = "sqlite" | "postgres";

const migrations = (kind: Kind): Record<string, Migration> => ({
  "001_feeds_and_notes": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("feeds")
        .addColumn("name", "text", (c) => c.primaryKey())
        .addColumn("read_id", "text", (c) => c.notNull().unique())
        .addColumn("password_hash", "text")
        .addColumn("settings", "text")
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("notes")
        .addColumn("feed", "text", (c) => c.notNull())
        .addColumn("id", "text", (c) => c.notNull())
        .addColumn("ext", "text", (c) => c.notNull())
        .addColumn("content", sql`${sql.raw(kind === "postgres" ? "bytea" : "blob")}`, (c) => c.notNull())
        .addColumn("metadata", "text")
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addColumn("updated_at", "bigint", (c) => c.notNull())
        .addPrimaryKeyConstraint("notes_pk", ["feed", "id"])
        .addForeignKeyConstraint("notes_feed_fk", ["feed"], "feeds", ["name"], (c) => c.onDelete("cascade"))
        .execute();
      await db.schema.createIndex("notes_by_time").on("notes").columns(["feed", "created_at"]).execute();
    },
  },
  // Image bytes may live in an image store (storage/images): the row then holds the key and an empty `content`, which stays NOT NULL
  // because SQLite cannot drop that without rebuilding the table. `size` is the content's, wherever it is.
  "002_image_store": {
    async up(db: Kysely<any>) {
      await db.schema.alterTable("notes").addColumn("blob_key", "text").execute();
      await db.schema.alterTable("notes").addColumn("size", "bigint", (c) => c.notNull().defaultTo(0)).execute();
      await sql`update notes set size = octet_length(content)`.execute(db);
    },
  },
  // The operator's takedown (issue #155): tombstones hold the name and the read id of a removed feed for good, blocked_images the
  // hashes of images that may not come back.
  "003_takedown": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("tombstones")
        .addColumn("name", "text", (c) => c.primaryKey())
        .addColumn("read_id", "text")
        .addColumn("removed_at", "bigint", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("tombstones_by_read_id").on("tombstones").column("read_id").execute();
      await db.schema
        .createTable("blocked_images")
        .addColumn("hash", "text", (c) => c.primaryKey())
        .addColumn("added_at", "bigint", (c) => c.notNull())
        .execute();
    },
  },
});

// A migration table that names one this code does not have: the database was made by a newer notefeed.
export const NEWER = "the database was made by a newer notefeed than this one; upgrade notefeed, do not point an older one at it";

export async function migrate(db: Kysely<any>, kind: Kind): Promise<void> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations(kind) } });
  const { error } = await migrator.migrateToLatest();
  if (!error) return;
  if (error instanceof Error && /migration/i.test(error.message) && /missing/i.test(error.message)) throw new Error(NEWER);
  throw error;
}
