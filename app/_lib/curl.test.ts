import { afterEach, expect, test, vi } from "vitest";
import { curlFor } from "./curl";

afterEach(() => vi.unstubAllEnvs());

test("the snippet declares the note's type: a post without a Content-Type is refused", () => {
  expect(curlFor("https://notes.example", "f", false)).toBe(`curl -H "Content-Type: text/markdown" -d "# Hello" https://notes.example/f`);
});

test("with the instance password and the feed's password the headers come first", () => {
  vi.stubEnv("NOTEFEED_PASSWORD", "pw");
  expect(curlFor("https://notes.example", "f", true)).toBe(
    `curl -H "Authorization: Bearer $NOTEFEED_PASSWORD" -H "X-Feed-Password: $NOTEFEED_FEED_PASSWORD" -H "Content-Type: text/markdown" -d "# Hello" https://notes.example/f`,
  );
});
