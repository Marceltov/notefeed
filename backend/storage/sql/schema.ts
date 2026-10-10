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
    // The key of the bytes in the image store; null when they are in `content`.
    blob_key: string | null;
    size: Time;
    metadata: string | null;
    created_at: Time;
    updated_at: Time;
  };
  tombstones: {
    name: string;
    read_id: string | null;
    removed_at: Time;
  };
  blocked_images: {
    hash: string;
    added_at: Time;
  };
}
