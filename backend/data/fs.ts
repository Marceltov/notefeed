// Paths under DATA_DIR. Callers pass names already checked by backend/feeds.ts and backend/notes.ts;
// nothing here validates them. turbopackIgnore on the fs calls stops the build from tracing the
// whole repo (DATA_DIR is only known at runtime).
import { join } from "node:path";
import { config } from "../config";

export const root = () => join(/*turbopackIgnore: true*/ config.dataDir());
export const feedDir = (feed: string) => join(/*turbopackIgnore: true*/ config.dataDir(), feed);

export const isErrno = (e: unknown, code: string) => (e as NodeJS.ErrnoException)?.code === code;

// `fallback` when the path doesn't exist; every other error propagates.
export async function orMissing<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (isErrno(e, "ENOENT")) return fallback;
    throw e;
  }
}
