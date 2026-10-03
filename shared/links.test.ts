import { expect, test } from "vitest";
import { absolutizeImages, isRelativeLink, placeImages, substitute } from "./links";

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
