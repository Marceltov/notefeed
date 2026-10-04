import { afterEach, expect, test } from "vitest";
import { config } from "./config";

afterEach(() => {
  delete process.env.NOTEFEED_MAX_IMAGES_PER_FEED;
  delete process.env.NOTEFEED_MAX_NOTES_PER_FEED;
  delete process.env.NOTEFEED_METRICS;
  delete process.env.NOTEFEED_METRICS_TOKEN;
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
