import { expect, test } from "vitest";
import { renderFeed } from "./rss";
import { imgNote, mdNote } from "./note/testing";

const notes = [
  mdNote({ id: "20260929T140512Z-a-b", markdown: "# A & <B>\ncode: a]]>b ]]> end", createdAt: new Date("2026-09-29T14:05:12Z"), tags: ["env:prod", "a&b"] }),
  mdNote({ id: "20260928T090000Z-plain", markdown: "Plain", createdAt: new Date("2026-09-28T09:00:00Z") }),
];
const xml = renderFeed(notes, { title: "my feed", description: "about it", baseUrl: "https://x.test", readId: "AbCdEfGhIjKlMnOpQrSt_-" });

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

test("lists tags as category elements", () => {
  expect(xml).toContain("<category>env:prod</category>\n<category>a&amp;b</category>");
  expect(xml.match(/<category>/g)).toHaveLength(2);
});

test("strips XML-forbidden control characters", () => {
  const out = renderFeed(
    [mdNote({ id: "20260929T140512Z-red", title: "\x1b[31mred", markdown: "\x1b[31mred\x1b[0m\ttab\r\nok", createdAt: new Date() })],
    { title: "t", description: "t", baseUrl: "https://x.test", readId: "AbCdEfGhIjKlMnOpQrSt_-" },
  );
  expect(out).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/);
  expect(out).toContain("[31mred[0m\ttab\r\nok");
});

test("a sender becomes an escaped dc:creator and declares the namespace; none, no namespace", () => {
  const o = { title: "t", description: "t", baseUrl: "https://x.test", readId: "AbCdEfGhIjKlMnOpQrSt_-" };
  const out = renderFeed([mdNote({ id: "20260928T090000Z-plain", markdown: "Plain", sender: "A & <B>" }), notes[0]], o);
  expect(out).toContain('<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">');
  expect(out.match(/<dc:creator>/g)).toHaveLength(1);
  expect(out).toContain("<dc:creator>A &amp; &lt;B&gt;</dc:creator>");
  expect(xml).not.toContain("dc");
});

const photoOpts = { title: "t", description: "t", baseUrl: "https://x.test", readId: "AbCdEfGhIjKlMnOpQrSt_-" };

test("an image note is an item with an enclosure, no description, and its id as title", () => {
  const out = renderFeed([imgNote({ id: "20260930T100000Z-pic", ext: "jpg", size: 2048, createdAt: new Date("2026-09-30T10:00:00Z") })], photoOpts);
  expect(out).toContain("<title>20260930T100000Z-pic</title>");
  expect(out).toContain('<enclosure url="https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-/20260930T100000Z-pic.jpg" length="2048" type="image/jpeg"/>');
  expect(out).toContain("<link>https://x.test/r/AbCdEfGhIjKlMnOpQrSt_-/20260930T100000Z-pic</link>"); // the note page, not the file
  expect(out.split("<item>")[1]).not.toContain("<description>"); // the channel has one
  expect(out).toContain("<pubDate>Wed, 30 Sep 2026 10:00:00 GMT</pubDate>");
});

test("a sidecar title is the item's title, for an image and for markdown; tags and sender still show", () => {
  const out = renderFeed(
    [imgNote({ id: "i1", title: "A <cat>", sender: "Ann", tags: ["pets"] }), mdNote({ id: "m1", markdown: "# Derived", title: "Set" })],
    photoOpts,
  );
  expect(out).toContain("<title>A &lt;cat&gt;</title>");
  expect(out).toContain("<title>Set</title>");
  expect(out).toContain("<dc:creator>Ann</dc:creator>");
  expect(out).toContain("<category>pets</category>");
});

test("a markdown item has no enclosure", () => {
  expect(renderFeed([mdNote({ id: "m1", markdown: "x" })], photoOpts)).not.toContain("<enclosure");
});
