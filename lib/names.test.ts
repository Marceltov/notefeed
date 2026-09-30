import { expect, test } from "vitest";
import { checkFeed } from "./feeds";
import { normalizeFeedInput, suggestFeedName } from "./names";

test("suggestions are valid, unreserved and have three parts", () => {
  for (let i = 0; i < 100; i++) {
    const name = suggestFeedName();
    expect(checkFeed(name)).toBeNull();
    expect(name.split("-")).toHaveLength(3);
    expect(name).toMatch(/-[a-z0-9]{4}$/);
  }
});

test("normalizeFeedInput lowercases, trims and joins words with -", () => {
  expect(normalizeFeedInput("  My Backups ")).toBe("my-backups");
  expect(normalizeFeedInput("a \t b")).toBe("a-b");
});
