import { expect, test } from "vitest";
import { onlyReferences, removeReference, substitute, uniqueToken } from "./pendingFiles";

test("uniqueToken keeps a free name and numbers a taken one before the extension", () => {
  expect(uniqueToken("a.png", new Set())).toBe("a.png");
  expect(uniqueToken("a.png", new Set(["a.png"]))).toBe("a-2.png");
  expect(uniqueToken("a.png", new Set(["a.png", "a-2.png"]))).toBe("a-3.png");
  expect(uniqueToken("noext", new Set(["noext"]))).toBe("noext-2");
});

test("uniqueToken makes a name safe to write in markdown, and never empty", () => {
  expect(uniqueToken("My Cat (1).png", new Set())).toBe("My-Cat-1-.png");
  expect(uniqueToken("", new Set())).toBe("image");
  expect(uniqueToken("../../x.png", new Set())).toBe("x.png");
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

test("onlyReferences: the text holds nothing but pictures that are waiting", () => {
  expect(onlyReferences("![](cat.png)\n![](dog.png)\n", ["cat.png", "dog.png"])).toBe(true);
  expect(onlyReferences("  \n![](cat.png)", ["cat.png"])).toBe(true);
  expect(onlyReferences("", ["cat.png"])).toBe(true);
  expect(onlyReferences("![](cat.png) hello", ["cat.png"])).toBe(false);
  expect(onlyReferences("![](other.png)", ["cat.png"])).toBe(false); // not one of ours
  expect(onlyReferences("![](cat.png)", [])).toBe(false);
});

test("removeReference drops the image line for a token and tidies the blank line it leaves", () => {
  expect(removeReference("before\n![](cat.png)\nafter", "cat.png")).toBe("before\nafter");
  expect(removeReference("![](cat.png)", "cat.png")).toBe("");
  expect(removeReference("text ![](cat.png) more", "cat.png")).toBe("text  more");
  expect(removeReference("![](cat.png)\n![](dog.png)", "cat.png")).toBe("![](dog.png)");
  expect(removeReference("![](big-cat.png)", "cat.png")).toBe("![](big-cat.png)");
});
