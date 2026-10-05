// Images in a folder: one file per key, in a subfolder named by the key's first two characters so no folder grows without bound.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertKey, type ImageStore } from "./types";

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";

export function createFsImageStore(dir: string): ImageStore {
  const pathOf = (key: string) => {
    assertKey(key);
    return join(/*turbopackIgnore: true*/ dir, key.slice(0, 2), key);
  };
  return {
    // Written beside its place and renamed into it, so a reader never sees half a file.
    async put(key, bytes) {
      const path = pathOf(key);
      const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(tmp, bytes, { flag: "wx" });
        await rename(tmp, path);
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => {});
        throw e;
      }
    },
    async get(key) {
      try {
        return await readFile(pathOf(key));
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}
