// Opens the database named by NOTEFEED_STORAGE and NOTEFEED_DATABASE_URL. The drivers are imported here, on first use, so an
// instance on the file system never loads them. Errors say which setting is wrong and never carry the URL (it holds a password).
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import type { Schema } from "./schema";
import type { Kind } from "./migrations";

export async function connect(kind: Kind, url: string): Promise<Kysely<Schema>> {
  if (kind === "postgres") {
    const { Pool } = await import("pg");
    return new Kysely<Schema>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }) });
  }
  const { default: Database } = await import("better-sqlite3");
  const path = url.startsWith("file:") ? url.slice("file:".length) : url;
  const file = path === ":memory:" || path === "" ? ":memory:" : path;
  if (file !== ":memory:") await mkdir(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
  const database = new Database(file);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON"); // the cascade that deletes a feed's notes
  return new Kysely<Schema>({ dialect: new SqliteDialect({ database }) });
}
