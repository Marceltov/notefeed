import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { storage, resetStorageForTests } from ".";
import type { SqlStorage } from "./sql";

const roots: string[] = [];
afterEach(async () => {
  for (const k of ["NOTEFEED_STORAGE", "NOTEFEED_DATABASE_URL", "NOTEFEED_SECRET", "DATA_DIR", "NOTEFEED_IMAGES", "NOTEFEED_IMAGES_DIR", "NOTEFEED_S3_ENDPOINT", "NOTEFEED_S3_BUCKET", "NOTEFEED_S3_ACCESS_KEY", "NOTEFEED_S3_SECRET_KEY"]) delete process.env[k];
  resetStorageForTests();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("storage() is cached per configuration", () => {
  process.env.DATA_DIR = "/tmp/nf-a";
  expect(storage()).toBe(storage());
});

test("a changed DATA_DIR gives a new instance", () => {
  process.env.DATA_DIR = "/tmp/nf-a";
  const a = storage();
  process.env.DATA_DIR = "/tmp/nf-b";
  expect(storage()).not.toBe(a);
});

test("an unknown backend throws, naming NOTEFEED_STORAGE", () => {
  process.env.NOTEFEED_STORAGE = "s3";
  expect(() => storage()).toThrow(/NOTEFEED_STORAGE/);
});

test("a database backend connects on first use, not when it is chosen", () => {
  process.env.NOTEFEED_STORAGE = "postgres";
  process.env.NOTEFEED_DATABASE_URL = "postgres://nobody:x@127.0.0.1:1/none";
  process.env.NOTEFEED_SECRET = "x".repeat(32);
  expect(() => storage()).not.toThrow();
});

test("a database backend without its settings throws when it is chosen", () => {
  process.env.NOTEFEED_STORAGE = "postgres";
  process.env.NOTEFEED_SECRET = "x".repeat(32);
  expect(() => storage()).toThrow(/NOTEFEED_DATABASE_URL/);
  process.env.NOTEFEED_STORAGE = "sqlite";
  delete process.env.NOTEFEED_SECRET;
  expect(() => storage()).toThrow(/NOTEFEED_SECRET/);
});

test("a changed NOTEFEED_IMAGES gives a new instance", () => {
  process.env.NOTEFEED_STORAGE = "sqlite";
  process.env.NOTEFEED_DATABASE_URL = "file::memory:";
  process.env.NOTEFEED_SECRET = "x".repeat(32);
  const a = storage();
  process.env.NOTEFEED_IMAGES = "fs";
  expect(storage()).not.toBe(a);
});

test("images outside the database are refused when the backend is chosen, if it is the file system or the store lacks its settings", () => {
  process.env.NOTEFEED_IMAGES = "fs";
  expect(() => storage()).toThrow(/NOTEFEED_IMAGES/);
  process.env.NOTEFEED_STORAGE = "sqlite";
  process.env.NOTEFEED_SECRET = "x".repeat(32);
  process.env.NOTEFEED_IMAGES = "s3";
  expect(() => storage()).toThrow(/NOTEFEED_S3_ENDPOINT/);
});

// better-sqlite3 and kysely need Node 22 (the project's version).
test.skipIf(Number(process.versions.node.split(".")[0]) < 22)("with NOTEFEED_IMAGES=fs an image lands in the folder, a text note does not, and both read back", async () => {
  const root = await mkdtemp(join(tmpdir(), "notefeed-storage-"));
  roots.push(root);
  process.env.DATA_DIR = root;
  process.env.NOTEFEED_STORAGE = "sqlite";
  process.env.NOTEFEED_SECRET = "x".repeat(32);
  process.env.NOTEFEED_IMAGES = "fs";
  const s = storage() as SqlStorage;
  try {
    await s.createFeed("f", "rid-f");
    await s.writeNote("f", "t", "md", "text", {});
    await expect(readdir(join(root, "images"))).rejects.toThrow();
    for (const ext of ["png", "jpg", "gif", "webp"]) await s.writeNote("f", `p-${ext}`, ext, Buffer.from(ext), {});
    expect((await readdir(join(root, "images"), { recursive: true })).filter((n) => /^..\/[0-9a-f]{32}$/.test(n.replaceAll("\\", "/")))).toHaveLength(4);
    expect((await s.readFile("f", "p-png.png"))?.toString()).toBe("png");
    expect((await s.readFile("f", "t.md"))?.toString()).toBe("text");
  } finally {
    await s.close();
  }
});
