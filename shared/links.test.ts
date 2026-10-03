import { expect, test } from "vitest";
import { absolutizeImages, isAttachmentName, isRelativeLink, placeImages, substitute } from "./links";

test("only a link with no scheme and no leading slash is relative", () => {
  expect(["a.png", "x/a.png"].map(isRelativeLink)).toEqual([true, true]);
  expect(["", "https://x.test/a.png", "//x.test/a.png", "/r/id/a.png", "data:image/png;base64,AA", "#top"].map(isRelativeLink)).toEqual(Array(6).fill(false));
});

test("absolutizeImages changes relative image links only", () => {
  const md = '![a](1.png) ![b](https://x.test/2.png) ![c](/r/old/3.png "t") [link](page.html) ![d](4.png "title")';
  expect(absolutizeImages(md, "https://n.test/r/id/")).toBe('![a](https://n.test/r/id/1.png) ![b](https://x.test/2.png) ![c](/r/old/3.png "t") [link](page.html) ![d](https://n.test/r/id/4.png "title")');
});

test("substitute replaces only an image whose destination is exactly a sent token", () => {
  const sent = new Map([["cat.png", "20261003T1-a.png"]]);
  expect(substitute("![a cat](cat.png)", sent)).toBe("![a cat](20261003T1-a.png)");
  expect(substitute("![](cat.png) and ![](cat.png)", sent)).toBe("![](20261003T1-a.png) and ![](20261003T1-a.png)");
});

test("substitute leaves a token in prose, in a link, or as part of another name", () => {
  const sent = new Map([["cat.png", "X.png"]]);
  expect(substitute("see cat.png and [cat](cat.png)", sent)).toBe("see cat.png and [cat](cat.png)");
  expect(substitute("![](big-cat.png) ![](cat.png.bak) ![](dir/cat.png)", sent)).toBe("![](big-cat.png) ![](cat.png.bak) ![](dir/cat.png)");
});

test("substitute with nothing sent is the identity", () => {
  expect(substitute("![](cat.png)", new Map())).toBe("![](cat.png)");
});

test("isAttachmentName takes one path segment of 1 to 200 characters", () => {
  for (const n of ["a.png", "Screenshot 2026-10-03 at 14.02.png", ".hidden", "100%.png"]) expect(isAttachmentName(n), n).toBe(true);
  for (const n of ["", ".", "..", "...", "a/b.png", "a\\b.png", " a.png", "a.png ", "a\n.png", "a".repeat(201)]) expect(isAttachmentName(n), JSON.stringify(n)).toBe(false);
  expect(isAttachmentName("a".repeat(200))).toBe(true);
});

test("placeImages swaps a referenced name and appends an unreferenced one", () => {
  const sent = new Map([["a.png", "F1.png"], ["b.png", "F2.png"]]);
  expect(placeImages("see ![x](a.png) and ![x](a.png)", sent)).toBe("see ![x](F1.png) and ![x](F1.png)\n\n![](F2.png)");
});

test("placeImages with empty markdown is only the references, in order", () => {
  expect(placeImages("", new Map([["a.png", "F1.png"], ["b.png", "F2.png"]]))).toBe("![](F1.png)\n\n![](F2.png)");
});

test("placeImages leaves other destinations and a map-less call alone", () => {
  expect(placeImages("![](https://x/a.png) ![](other.png)", new Map([["a.png", "F1.png"]]))).toBe("![](https://x/a.png) ![](other.png)\n\n![](F1.png)");
  expect(placeImages("text", new Map())).toBe("text");
});

const one = new Map([["a.png", "F1.png"]]);

test("placeImages keeps a title and appends nothing for a referenced picture", () => {
  expect(placeImages('see ![](a.png "A chart")', one)).toBe('see ![](F1.png "A chart")');
});

test("placeImages swaps the destination of a definition", () => {
  expect(placeImages('![x][l]\n\n[l]: a.png "T"', one)).toBe('![x][l]\n\n[l]: F1.png "T"');
});

test("placeImages matches angle-bracketed and percent-encoded destinations", () => {
  const sent = new Map([["a b.png", "F1.png"]]);
  expect(placeImages("![](<a b.png>) ![](a%20b.png)", sent)).toBe("![](F1.png) ![](F1.png)");
  expect(placeImages("![](100%.png)", new Map([["100%.png", "F1.png"]]))).toBe("![](F1.png)");
});

test("placeImages prefers an exact match over a decoded one", () => {
  const sent = new Map([["a b.png", "F1.png"], ["a%20b.png", "F2.png"]]);
  expect(placeImages("![](a%20b.png)", sent)).toBe("![](F2.png)\n\n![](F1.png)");
});

test("placeImages leaves images in code as written and appends their picture", () => {
  expect(placeImages("```\n![](a.png)\n```\n\n`![](a.png)`", one)).toBe("```\n![](a.png)\n```\n\n`![](a.png)`\n\n![](F1.png)");
});

test("placeImages keeps CRLF and a trailing newline when nothing is appended", () => {
  expect(placeImages("x\r\n![](a.png)\r\n", one)).toBe("x\r\n![](F1.png)\r\n");
});
