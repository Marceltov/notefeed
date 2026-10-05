// Images in a folder: one file per key, in a subfolder named by the key's first two characters so no folder grows without bound.
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertKey, isKey, type ImageStore } from "./types";

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
    // A file being written (`<key>.<random>.tmp`), or anything else someone put in the folder, is not named like a key and is passed over.
    async *list() {
      const folders = await readdir(/*turbopackIgnore: true*/ dir).catch((e) => (isMissing(e) ? [] : Promise.reject(e)));
      for (const folder of folders) {
        if (!/^[0-9a-f]{2}$/.test(folder)) continue;
        const names = await readdir(join(/*turbopackIgnore: true*/ dir, folder)).catch((e) => (isMissing(e) || (e as NodeJS.ErrnoException)?.code === "ENOTDIR" ? [] : Promise.reject(e)));
        for (const key of names) {
          if (!isKey(key) || !key.startsWith(folder)) continue;
          const info = await stat(join(/*turbopackIgnore: true*/ dir, folder, key)).catch((e) => (isMissing(e) ? null : Promise.reject(e))); // deleted since the listing
          if (info?.isFile()) yield { key, size: info.size, modified: info.mtime };
        }
      }
    },
  };
}
