import { expect, test } from "vitest";
import { absolutizeImages, isRelativeLink } from "./links";

test("only a link with no scheme and no leading slash is relative", () => {
  expect(["a.png", "x/a.png"].map(isRelativeLink)).toEqual([true, true]);
  expect(["", "https://x.test/a.png", "//x.test/a.png", "/r/id/a.png", "data:image/png;base64,AA", "#top"].map(isRelativeLink)).toEqual(Array(6).fill(false));
});

test("absolutizeImages changes relative image links only", () => {
  const md = '![a](1.png) ![b](https://x.test/2.png) ![c](/r/old/3.png "t") [link](page.html) ![d](4.png "title")';
  expect(absolutizeImages(md, "https://n.test/r/id/")).toBe('![a](https://n.test/r/id/1.png) ![b](https://x.test/2.png) ![c](/r/old/3.png "t") [link](page.html) ![d](https://n.test/r/id/4.png "title")');
});
