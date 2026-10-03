import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { imgNote, mdNote } from "@/backend/note/testing";
import { NoteArticle, NoteList } from "./NoteList";

const list = (notes: Parameters<typeof NoteList>[0]["notes"], imageBase = "/r/rid/") => renderToStaticMarkup(<NoteList notes={notes} base="/feed" imageBase={imageBase} />);

test("an image note shows its picture from the read link, linked to its page", () => {
  const html = list([imgNote({ id: "20260930T100000Z-pic", ext: "jpg", createdAt: new Date("2026-09-30T10:00:00Z") })]);
  expect(html).toMatch(/<a [^>]*href="\/feed\/20260930T100000Z-pic"/);
  expect(html).toMatch(/<img src="\/r\/rid\/20260930T100000Z-pic\.jpg"/);
  expect(html).not.toContain("![]("); // no raw markdown
});

test("the picture's alt text is the note's alt, else its title, else empty", () => {
  const alts = (html: string) => [...html.matchAll(/<img[^>]*alt="([^"]*)"/g)].map((m) => m[1]);
  const at = new Date("2026-09-30T10:00:00Z");
  expect(alts(list([imgNote({ id: "a", createdAt: at })]))).toEqual([""]);
  expect(alts(list([imgNote({ id: "b", createdAt: at, title: "Titled" })]))).toEqual(["Titled"]);
});

test("an image note's title shows as its link text above the picture; none shows no id", () => {
  const at = new Date("2026-09-30T10:00:00Z");
  expect(list([imgNote({ id: "x1", createdAt: at, title: "A cat" })])).toContain(">A cat</a>");
  expect(list([imgNote({ id: "x2", createdAt: at })])).not.toContain(">x2</a>");
});

test("a markdown note is listed as before: title link, then the rest of the text", () => {
  const html = list([mdNote({ id: "m1", markdown: "# Hello\nsome *text*", createdAt: new Date("2026-09-30T10:00:00Z") })]);
  expect(html).toContain(">Hello</a>");
  expect(html).toContain("<em>text</em>");
});

test("the note page shows the picture large, with its title", () => {
  const html = renderToStaticMarkup(<NoteArticle note={imgNote({ id: "p1", ext: "webp", title: "Cat", createdAt: new Date("2026-09-30T10:00:00Z") })} back="/feed" imageBase="/r/rid/" />);
  expect(html).toMatch(/<img src="\/r\/rid\/p1\.webp"/);
  expect(html).toContain(">Cat<");
});
