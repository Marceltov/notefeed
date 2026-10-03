import { expect, test } from "vitest";
import { onlyReferences, removeReference, uniqueToken } from "./pendingFiles";

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

test("uniqueToken never returns a name made only of dots", () => {
  expect(uniqueToken("..", new Set())).toBe("image");
  expect(uniqueToken(".", new Set())).toBe("image");
  expect(uniqueToken("...", new Set(["image"]))).toBe("image-2");
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

test("uniqueToken keeps a token within 200 characters, with its extension, and still numbers collisions", () => {
  const long = "a".repeat(251) + ".png";
  const token = uniqueToken(long, new Set());
  expect(token.length).toBeLessThanOrEqual(200);
  expect(token.endsWith(".png")).toBe(true);
  const next = uniqueToken(long, new Set([token]));
  expect(next).not.toBe(token);
  expect(next.length).toBeLessThanOrEqual(200);
  expect(next.endsWith("-2.png")).toBe(true);
  expect(uniqueToken("b".repeat(255), new Set()).length).toBeLessThanOrEqual(200);
});
