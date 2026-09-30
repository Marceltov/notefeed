import { expect, test } from "vitest";
import { checkFeed } from "./feeds";
import { normalizeFeedInput, suggestFeedName } from "./names";

test("suggestions are valid, unreserved and have three parts", () => {
  for (let i = 0; i < 100; i++) {
    const name = suggestFeedName();
    expect(checkFeed(name)).toBeNull();
    expect(name.split("-")).toHaveLength(3);
    // 36^13 ≈ 2^67: a suggested name can't be found by guessing.
    expect(name).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]{13}$/);
    expect(name.length).toBeLessThanOrEqual(64);
  }
});

test("normalizeFeedInput lowercases, trims and joins words with -", () => {
  expect(normalizeFeedInput("  My Backups ")).toBe("my-backups");
  expect(normalizeFeedInput("a \t b")).toBe("a-b");
});
