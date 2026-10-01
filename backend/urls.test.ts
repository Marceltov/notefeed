import { afterEach, describe, expect, test } from "vitest";
import { feedPath, publicUrl, readPath, rssPath, safeNext } from "./urls";

afterEach(() => {
  delete process.env.PUBLIC_URL;
  delete process.env.NOTEFEED_TRUST_PROXY;
});

test("PUBLIC_URL wins, without trailing slash", () => {
  process.env.PUBLIC_URL = "https://notes.example/";
  expect(publicUrl(new Headers({ host: "x" }))).toBe("https://notes.example");
});

test("forwarded headers come next, only with NOTEFEED_TRUST_PROXY=1", () => {
  const h = new Headers({ "x-forwarded-proto": "https", "x-forwarded-host": "notes.lan, proxy", host: "internal:3000" });
  expect(publicUrl(h)).toBe("http://internal:3000");
  process.env.NOTEFEED_TRUST_PROXY = "1";
  expect(publicUrl(h)).toBe("https://notes.lan");
});

test("falls back to Host over http", () => {
  expect(publicUrl(new Headers({ host: "localhost:3000" }))).toBe("http://localhost:3000");
});

test("empty PUBLIC_URL counts as unset", () => {
  process.env.PUBLIC_URL = "";
  expect(publicUrl(new Headers({ host: "localhost:3000" }))).toBe("http://localhost:3000");
});

test("read-side paths go through the read id", () => {
  expect(feedPath("backups")).toBe("/backups");
  expect(readPath("AbCdEfGhIjKlMnOpQrSt_-")).toBe("/r/AbCdEfGhIjKlMnOpQrSt_-");
  expect(rssPath("AbCdEfGhIjKlMnOpQrSt_-")).toBe("/r/AbCdEfGhIjKlMnOpQrSt_-/feed.xml");
});

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
