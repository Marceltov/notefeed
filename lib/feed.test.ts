import { expect, test } from "vitest";
import { renderFeed } from "./feed";
import type { Note } from "./notes";

const notes: Note[] = [
  {
    id: "20260929T140512Z-a-b",
    title: "A & <B>",
    markdown: "# A & <B>\ncode: a]]>b ]]> end",
    createdAt: new Date("2026-09-29T14:05:12Z"),
  },
  { id: "20260928T090000Z-plain", title: "Plain", markdown: "Plain", createdAt: new Date("2026-09-28T09:00:00Z") },
];
const xml = renderFeed(notes, { title: "my feed", baseUrl: "https://x.test", readId: "AbCdEfGhIjKlMnOpQrSt_-" });

test("is an RSS 2.0 document", () => {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  expect(xml.match(/<rss version="2.0">/g)).toHaveLength(1);
  expect(xml).toContain("<title>my feed</title>");
});

test("escapes titles", () => {
  expect(xml).toContain("<title>A &amp; &lt;B&gt;</title>");
});

test("keeps ]]> intact across CDATA sections", () => {
  const desc = /<description>(.*?)<\/description>/s.exec(xml.split("<item>")[1])![1];
  const text = [...desc.matchAll(/<!\[CDATA\[(.*?)\]\]>/gs)].map((m) => m[1]).join("");
  expect(text).toBe(notes[0].markdown);
});

test("links are absolute and go through the read id", () => {
  expect(xml).toContain("<link>https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-</link>");
  expect(xml).toContain("<link>https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-/20260929T140512Z-a-b</link>");
  expect(xml).toContain('<guid isPermaLink="true">https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-/20260929T140512Z-a-b</guid>');
  expect(xml).not.toContain("/n/");
});

test("pubDate is RFC 822", () => {
  expect(xml).toContain("<pubDate>Tue, 29 Sep 2026 14:05:12 GMT</pubDate>");
});

test("strips XML-forbidden control characters", () => {
  const out = renderFeed(
    [{ id: "20260929T140512Z-red", title: "\x1b[31mred", markdown: "\x1b[31mred\x1b[0m\ttab\r\nok", createdAt: new Date() }],
    { title: "t", baseUrl: "https://x.test", readId: "AbCdEfGhIjKlMnOpQrSt_-" },
  );
  expect(out).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/);
  expect(out).toContain("[31mred[0m\ttab\r\nok");
});
