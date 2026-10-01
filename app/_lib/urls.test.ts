import { describe, expect, test } from "vitest";
import { safeNext } from "./urls";

describe("safeNext", () => {
  test.each(["/my-feed", "/my-feed?x=1", "/r/abc/x", "/"])("keeps %j", (v) => expect(safeNext(v)).toBe(v));
  test.each([
    null,
    "",
    "my-feed",
    "//evil.example",
    "https://evil.example",
    "/\\evil.example",
    "/x\\y",
    "\\evil.example",
    "/\t/evil.example", // browsers drop tabs and newlines, which would make this //evil.example
    "/\n/evil.example",
  ])("rejects %j", (v) => expect(safeNext(v)).toBe("/"));
});
