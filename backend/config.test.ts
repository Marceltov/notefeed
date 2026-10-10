import { afterEach, expect, test } from "vitest";
import { config } from "./config";

const S3_VARS = ["NOTEFEED_S3_ENDPOINT", "NOTEFEED_S3_BUCKET", "NOTEFEED_S3_REGION", "NOTEFEED_S3_ACCESS_KEY", "NOTEFEED_S3_SECRET_KEY"];

afterEach(() => {
  delete process.env.NOTEFEED_MAX_IMAGES_PER_FEED;
  delete process.env.NOTEFEED_REPORT_URL;
  delete process.env.NOTEFEED_IMAGE_UPLOADS;
  delete process.env.NOTEFEED_MAX_NOTES_PER_FEED;
  delete process.env.NOTEFEED_METRICS;
  delete process.env.NOTEFEED_REPORT_ENDPOINT;
  delete process.env.NOTEFEED_METRICS_TOKEN;
  for (const k of ["NOTEFEED_STORAGE", "NOTEFEED_DATABASE_URL", "NOTEFEED_SECRET", "DATA_DIR", "NOTEFEED_IMAGES", "NOTEFEED_IMAGES_DIR", ...S3_VARS]) delete process.env[k];
});

test("the report URL template is empty unless set, and trimmed; with an endpoint and no template, the link opens the built-in page", () => {
  expect(config.reportUrl()).toBe("");
  expect(config.reportEndpoint()).toBe("");
  process.env.NOTEFEED_REPORT_ENDPOINT = " https://inbox.example/f/notefeed-report ";
  expect(config.reportEndpoint()).toBe("https://inbox.example/f/notefeed-report");
  expect(config.reportUrl()).toBe("/report?read_id={read_id}&note_id={note_id}&file={file}");
  process.env.NOTEFEED_REPORT_URL = " https://r.example/?r={read_id} ";
  expect(config.reportUrl()).toBe("https://r.example/?r={read_id}");
});

test("image uploads are on unless NOTEFEED_IMAGE_UPLOADS is 0", () => {
  for (const v of [undefined, "", "1", "off", "false"]) {
    if (v === undefined) delete process.env.NOTEFEED_IMAGE_UPLOADS;
    else process.env.NOTEFEED_IMAGE_UPLOADS = v;
    expect(config.imageUploads()).toBe(true);
  }
  for (const v of ["0", " 0 "]) {
    process.env.NOTEFEED_IMAGE_UPLOADS = v;
    expect(config.imageUploads()).toBe(false);
  }
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

test("images default to db and accept fs and s3", () => {
  expect(config.images()).toBe("db");
  process.env.NOTEFEED_IMAGES = "FS";
  expect(config.images()).toBe("fs");
  process.env.NOTEFEED_IMAGES = "s3";
  expect(config.images()).toBe("s3");
});

test("images throws on any other value, naming NOTEFEED_IMAGES", () => {
  process.env.NOTEFEED_IMAGES = "gcs";
  expect(() => config.images()).toThrow(/NOTEFEED_IMAGES/);
});

test("imagesDir defaults to a folder in DATA_DIR", () => {
  process.env.DATA_DIR = "/srv/nf/";
  expect(config.imagesDir()).toBe("/srv/nf/images");
  process.env.NOTEFEED_IMAGES_DIR = "/mnt/img";
  expect(config.imagesDir()).toBe("/mnt/img");
});

test("s3: the region defaults to us-east-1 and the endpoint loses its trailing slash", () => {
  process.env.NOTEFEED_S3_ENDPOINT = "https://s3.example.com/";
  expect(config.s3().region).toBe("us-east-1");
  expect(config.s3().endpoint).toBe("https://s3.example.com");
  process.env.NOTEFEED_S3_REGION = "fsn1";
  expect(config.s3().region).toBe("fsn1");
});

test("validateStorage: images outside the database need a database backend", () => {
  for (const images of ["fs", "s3"]) {
    process.env.NOTEFEED_IMAGES = images;
    expect(() => config.validateStorage()).toThrow(/NOTEFEED_IMAGES/);
  }
  process.env.NOTEFEED_IMAGES = "db";
  expect(() => config.validateStorage()).not.toThrow();
});

test("validateStorage: an unknown NOTEFEED_IMAGES is refused on every backend", () => {
  process.env.NOTEFEED_IMAGES = "gcs";
  expect(() => config.validateStorage()).toThrow(/NOTEFEED_IMAGES/);
});

test("validateStorage: s3 names the missing setting and no value", () => {
  process.env.NOTEFEED_STORAGE = "sqlite";
  process.env.NOTEFEED_SECRET = "x".repeat(32);
  process.env.NOTEFEED_IMAGES = "s3";
  const all: Record<string, string> = {
    NOTEFEED_S3_ENDPOINT: "https://s3.example.com",
    NOTEFEED_S3_BUCKET: "bucket-b",
    NOTEFEED_S3_ACCESS_KEY: "access-a",
    NOTEFEED_S3_SECRET_KEY: "secret-s",
  };
  for (const missing of Object.keys(all)) {
    for (const [k, v] of Object.entries(all)) process.env[k] = v;
    delete process.env[missing];
    const err = (() => {
      try {
        config.validateStorage();
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err?.message).toContain(missing);
    for (const v of Object.values(all)) expect(err?.message).not.toContain(v);
  }
  for (const [k, v] of Object.entries(all)) process.env[k] = v;
  expect(() => config.validateStorage()).not.toThrow();
});

test("validateStorage: an endpoint that is not an http(s) URL is refused without being shown", () => {
  process.env.NOTEFEED_STORAGE = "sqlite";
  process.env.NOTEFEED_SECRET = "x".repeat(32);
  process.env.NOTEFEED_IMAGES = "s3";
  process.env.NOTEFEED_S3_ENDPOINT = "s3.example.com";
  process.env.NOTEFEED_S3_BUCKET = "b";
  process.env.NOTEFEED_S3_ACCESS_KEY = "a";
  process.env.NOTEFEED_S3_SECRET_KEY = "s";
  expect(() => config.validateStorage()).toThrow(/NOTEFEED_S3_ENDPOINT/);
  expect(() => config.validateStorage()).not.toThrow(/s3\.example\.com/);
});

test("validateStorage: images in a folder need nothing more", () => {
  process.env.NOTEFEED_STORAGE = "sqlite";
  process.env.NOTEFEED_SECRET = "x".repeat(32);
  process.env.NOTEFEED_IMAGES = "fs";
  expect(() => config.validateStorage()).not.toThrow();
});
