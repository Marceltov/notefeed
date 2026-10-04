// The tables, as Kysely sees them. Times are milliseconds since the epoch (a bigint in PostgreSQL, so `pg` gives it back as a
// string: read it with Number()). JSON columns are plain text: nothing queries inside them.
import type { ColumnType } from "kysely";

type Time = ColumnType<number | string, number, number>;

export interface Schema {
  feeds: {
    name: string;
    read_id: string;
    password_hash: string | null;
    settings: string | null;
    created_at: Time;
  };
  notes: {
    feed: string;
    id: string;
    ext: string;
    content: Buffer;
    metadata: string | null;
    created_at: Time;
    updated_at: Time;
  };
}
