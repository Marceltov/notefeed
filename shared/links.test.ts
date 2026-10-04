import { expect, test } from "vitest";
import { absolutizeImages, isAttachmentName, isRelativeLink, placeImages, safeName } from "./links";

test("only a link with no scheme and no leading slash is relative", () => {
  expect(["a.png", "x/a.png"].map(isRelativeLink)).toEqual([true, true]);
  expect(["", "https://x.test/a.png", "//x.test/a.png", "/r/id/a.png", "data:image/png;base64,AA", "#top"].map(isRelativeLink)).toEqual(Array(6).fill(false));
});

test("absolutizeImages changes relative image links only", () => {
  const md = '![a](1.png) ![b](https://x.test/2.png) ![c](/r/old/3.png "t") [link](page.html) ![d](4.png "title")';
  expect(absolutizeImages(md, "https://n.test/r/id/")).toBe('![a](https://n.test/r/id/1.png) ![b](https://x.test/2.png) ![c](/r/old/3.png "t") [link](page.html) ![d](https://n.test/r/id/4.png "title")');
});

test("isAttachmentName takes one path segment of 1 to 200 characters", () => {
  for (const n of ["a.png", "Screenshot 2026-10-03 at 14.02.png", ".hidden", "100%.png"]) expect(isAttachmentName(n), n).toBe(true);
  for (const n of ["", ".", "..", "...", "a/b.png", "a\\b.png", " a.png", "a.png ", "a\n.png", "a".repeat(201)]) expect(isAttachmentName(n), JSON.stringify(n)).toBe(false);
  expect(isAttachmentName("a".repeat(200))).toBe(true);
});

test("isAttachmentName refuses C1 controls and text-direction overrides, and takes any other script", () => {
  for (const c of ["\u0085", "\u009b", "\u202e", "\u2066", "\u202a", "\u2069", "\u0080", "\u009f"]) expect(isAttachmentName(`a${c}b.png`), JSON.stringify(c)).toBe(false);
  for (const n of ["a\u200eb.png", "a\u200fb.png", "صورة.png", "תמונה.png", "图片.png", "😀.png", "é\u00a0à.png"]) expect(isAttachmentName(n), n).toBe(true);
});

test("safeName shows each forbidden character as U+FFFD and cuts to 200", () => {
  expect(safeName("evil\u202egnp\u009b[31m/\\\n.exe")).toBe("evil\ufffdgnp\ufffd[31m\ufffd\ufffd\ufffd.exe");
  expect(safeName("a.png")).toBe("a.png");
  expect(safeName("a\u200eb")).toBe("a\u200eb");
  expect(safeName("a".repeat(300))).toHaveLength(200);
});

test("placeImages swaps a referenced name and appends an unreferenced one", () => {
  const sent = new Map([["a.png", "F1.png"], ["b.png", "F2.png"]]);
  expect(placeImages("see ![x](a.png) and ![x](a.png)", sent)).toBe("see ![x](F1.png) and ![x](F1.png)\n\n![](F2.png)");
});

test("placeImages keeps a leading BOM and still finds the references after it", () => {
  expect(placeImages("\uFEFF# Hi\n\n![](a.png)", new Map([["a.png", "F1.png"]]))).toBe("\uFEFF# Hi\n\n![](F1.png)");
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

test("placeImages finds the destination after nested brackets in the alt text", () => {
  expect(placeImages("![a [b] c](a.png)", one)).toBe("![a [b] c](F1.png)");
});

test("placeImages leaves a destination with balanced parentheses that is no attachment as written", () => {
  expect(placeImages("![](x(1).png) end", one)).toBe("![](x(1).png) end\n\n![](F1.png)");
});

test("placeImages matches a name with parentheses, in angle brackets and percent-encoded", () => {
  const sent = new Map([["a (1).png", "F1.png"]]);
  expect(placeImages("![](<a (1).png>) ![x](a%20(1).png) end", sent)).toBe("![](F1.png) ![x](F1.png) end");
});

test("placeImages swaps a definition's angle-bracketed or percent-encoded destination", () => {
  const sent = new Map([["a b.png", "F1.png"]]);
  expect(placeImages('![x][l]\n\n[l]: <a b.png> "T"', sent)).toBe('![x][l]\n\n[l]: F1.png "T"');
  expect(placeImages("![x][l]\n\n[l]: a%20b.png", sent)).toBe("![x][l]\n\n[l]: F1.png");
});

test("placeImages changes a definition shared by an image and a link once, for both", () => {
  expect(placeImages("![x][l] and [the file][l]\n\n[l]: a.png", one)).toBe("![x][l] and [the file][l]\n\n[l]: F1.png");
});

test("placeImages leaves a malformed percent destination as written and appends the picture", () => {
  expect(placeImages("![](100%zz.png)", one)).toBe("![](100%zz.png)\n\n![](F1.png)");
});

test("placeImages swaps only the first definition of a label: a later one is dead, left as written, and its picture is appended", () => {
  const sent = new Map([["a.png", "F1.png"], ["b.png", "F2.png"]]);
  expect(placeImages("![chart][l]\n\n[l]: a.png\n[l]: b.png", sent)).toBe("![chart][l]\n\n[l]: F1.png\n[l]: b.png\n\n![](F2.png)");
  // a label is matched as markdown does: case and inner whitespace do not tell two apart
  expect(placeImages("![chart][l]\n\n[L]: a.png\n[l]: b.png", sent)).toBe("![chart][l]\n\n[L]: F1.png\n[l]: b.png\n\n![](F2.png)");
  expect(placeImages("![chart][my  pic]\n\n[My Pic]: a.png\n[my pic]: b.png", sent)).toBe("![chart][my  pic]\n\n[My Pic]: F1.png\n[my pic]: b.png\n\n![](F2.png)");
  // the first definition wins even when it names no attachment
  expect(placeImages("![chart][l]\n\n[l]: https://x.test/c.png\n[l]: b.png", new Map([["b.png", "F2.png"]]))).toBe("![chart][l]\n\n[l]: https://x.test/c.png\n[l]: b.png\n\n![](F2.png)");
  // two labels, one definition each: both swapped
  expect(placeImages("![x][l] ![y][m]\n\n[l]: a.png\n[m]: b.png", sent)).toBe("![x][l] ![y][m]\n\n[l]: F1.png\n[m]: F2.png");
});
