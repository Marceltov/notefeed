import { afterEach, expect, test } from "vitest";
import { config } from "./config";

afterEach(() => {
  delete process.env.NOTEFEED_MAX_IMAGES_PER_FEED;
  delete process.env.NOTEFEED_MAX_NOTES_PER_FEED;
});

test("a fractional cap is cut to a whole number: 0.5 is no cap, 2.9 is 2", () => {
  process.env.NOTEFEED_MAX_IMAGES_PER_FEED = "0.5";
  process.env.NOTEFEED_MAX_NOTES_PER_FEED = "2.9";
  expect(config.maxImagesPerFeed()).toBe(0);
  expect(config.maxNotesPerFeed()).toBe(2);
});
