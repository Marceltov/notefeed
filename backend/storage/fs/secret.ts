// The generated server secret, `<DATA_DIR>/.secret` (mode 0600). Sync: it is read once per process,
// from code that runs while rendering.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isErrno, root } from "./fs";

export const secretPath = () => join(/*turbopackIgnore: true*/ root(), ".secret");

// The stored bytes, or 32 new random ones written first. Never replaces an existing file.
export function loadOrCreateSecret(): Buffer {
  const file = secretPath();
  try {
    return readFileSync(/*turbopackIgnore: true*/ file);
  } catch (e) {
    if (!isErrno(e, "ENOENT")) throw e;
  }
  mkdirSync(/*turbopackIgnore: true*/ root(), { recursive: true });
  try {
    const s = randomBytes(32);
    writeFileSync(/*turbopackIgnore: true*/ file, s, { mode: 0o600, flag: "wx" });
    return s;
  } catch (e) {
    if (!isErrno(e, "EEXIST")) throw e;
    return readFileSync(/*turbopackIgnore: true*/ file); // another process won the race
  }
}
