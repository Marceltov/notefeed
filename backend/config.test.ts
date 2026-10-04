import { afterEach, expect, test } from "vitest";
import { config } from "./config";

afterEach(() => {
  delete process.env.NOTEFEED_MAX_IMAGES_PER_FEED;
  delete process.env.NOTEFEED_MAX_NOTES_PER_FEED;
  delete process.env.NOTEFEED_METRICS;
  delete process.env.NOTEFEED_METRICS_TOKEN;
  for (const k of ["NOTEFEED_STORAGE", "NOTEFEED_DATABASE_URL", "NOTEFEED_SECRET", "DATA_DIR"]) delete process.env[k];
});

test("metrics are on only for NOTEFEED_METRICS=1; the token is empty when unset", () => {
  for (const v of [undefined, "", "0", "true"]) {
    if (v === undefined) delete process.env.NOTEFEED_METRICS;
    else process.env.NOTEFEED_METRICS = v;
    expect(config.metrics()).toBe(false);
  }
  process.env.NOTEFEED_METRICS = "1";
  expect(config.metrics()).toBe(true);
  expect(config.metricsToken()).toBe("");
  process.env.NOTEFEED_METRICS_TOKEN = "s3cret";
  expect(config.metricsToken()).toBe("s3cret");
});

test("a fractional cap is cut to a whole number: 0.5 is no cap, 2.9 is 2", () => {
  process.env.NOTEFEED_MAX_IMAGES_PER_FEED = "0.5";
  process.env.NOTEFEED_MAX_NOTES_PER_FEED = "2.9";
  expect(config.maxImagesPerFeed()).toBe(0);
  expect(config.maxNotesPerFeed()).toBe(2);
});

test("storage defaults to fs and accepts sqlite and postgres", () => {
  expect(config.storage()).toBe("fs");
  process.env.NOTEFEED_STORAGE = "sqlite";
  expect(config.storage()).toBe("sqlite");
  process.env.NOTEFEED_STORAGE = "postgres";
  expect(config.storage()).toBe("postgres");
});

test("storage throws on any other value, naming NOTEFEED_STORAGE", () => {
  process.env.NOTEFEED_STORAGE = "s3";
  expect(() => config.storage()).toThrow(/NOTEFEED_STORAGE/);
});

test("databaseUrl defaults to a file in DATA_DIR for sqlite", () => {
  process.env.DATA_DIR = "/srv/nf";
  process.env.NOTEFEED_STORAGE = "sqlite";
  expect(config.databaseUrl()).toBe("file:/srv/nf/notefeed.db");
  process.env.NOTEFEED_DATABASE_URL = "file:/x/y.db";
  expect(config.databaseUrl()).toBe("file:/x/y.db");
});

test("validateStorage: postgres without NOTEFEED_DATABASE_URL throws", () => {
  process.env.NOTEFEED_STORAGE = "postgres";
  process.env.NOTEFEED_SECRET = "x".repeat(32);
  expect(() => config.validateStorage()).toThrow(/NOTEFEED_DATABASE_URL/);
});

test("validateStorage: sqlite and postgres need a 32-byte NOTEFEED_SECRET", () => {
  process.env.NOTEFEED_DATABASE_URL = "postgres://u:p@h/db";
  for (const kind of ["sqlite", "postgres"]) {
    process.env.NOTEFEED_STORAGE = kind;
    delete process.env.NOTEFEED_SECRET;
    expect(() => config.validateStorage()).toThrow(/NOTEFEED_SECRET/);
    process.env.NOTEFEED_SECRET = "short";
    expect(() => config.validateStorage()).toThrow(/NOTEFEED_SECRET/);
    process.env.NOTEFEED_SECRET = "x".repeat(32);
    expect(() => config.validateStorage()).not.toThrow();
  }
});

test("validateStorage: fs needs no secret and no URL", () => {
  expect(() => config.validateStorage()).not.toThrow();
});
