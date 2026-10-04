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
