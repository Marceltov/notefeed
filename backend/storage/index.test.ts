import { afterEach, expect, test } from "vitest";
import { storage, resetStorageForTests } from ".";

afterEach(() => {
  for (const k of ["NOTEFEED_STORAGE", "NOTEFEED_DATABASE_URL", "NOTEFEED_SECRET", "DATA_DIR"]) delete process.env[k];
  resetStorageForTests();
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
