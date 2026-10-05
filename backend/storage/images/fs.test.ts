import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { describeImageStore } from "./contract";
import { createFsImageStore } from "./fs";
import { newKey } from "./types";

const roots: string[] = [];
async function fresh() {
  const root = await mkdtemp(join(tmpdir(), "notefeed-images-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describeImageStore("fs", async () => createFsImageStore(await fresh()));

test("an object is one file under its key's first two characters, with no temporary file left", async () => {
  const root = await fresh();
  const store = createFsImageStore(root);
  const key = newKey();
  await store.put(key, Buffer.from("x"));
  await store.put(key, Buffer.from("y"));
  expect(await readdir(root)).toEqual([key.slice(0, 2)]);
  expect(await readdir(join(root, key.slice(0, 2)))).toEqual([key]);
});

test("the folder is made on the first put, however deep", async () => {
  const root = join(await fresh(), "a", "b");
  const store = createFsImageStore(root);
  const key = newKey();
  await store.put(key, Buffer.from("x"));
  expect((await store.get(key))?.toString()).toBe("x");
});

test("get and delete on a folder that does not exist yet are null and nothing", async () => {
  const store = createFsImageStore(join(await fresh(), "none"));
  expect(await store.get(newKey())).toBeNull();
  await expect(store.delete(newKey())).resolves.toBeUndefined();
});

test("list on a folder that does not exist yet is empty", async () => {
  const store = createFsImageStore(join(await fresh(), "none"));
  const listed = [];
  for await (const o of store.list()) listed.push(o);
  expect(listed).toEqual([]);
});

test("list passes over what is not an image of ours: a half-written file, a stray file, a folder named like a key", async () => {
  const root = await fresh();
  const store = createFsImageStore(root);
  const key = newKey();
  await store.put(key, Buffer.from("x"));
  const folder = join(root, key.slice(0, 2));
  await writeFile(join(folder, `${key}.abcdef.tmp`), "half");
  await writeFile(join(folder, "notes.txt"), "stray");
  await writeFile(join(root, "README"), "stray");
  await mkdir(join(root, "zz"));
  await mkdir(join(folder, `${key.slice(0, 2)}${"0".repeat(30)}`));
  const listed = [];
  for await (const o of store.list()) listed.push(o.key);
  expect(listed).toEqual([key]);
});
