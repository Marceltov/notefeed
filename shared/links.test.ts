import { expect, test } from "vitest";
import { absolutizeImages, isAttachmentName, isRelativeLink, safeName } from "./links";

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
  for (const c of ["\u0085", "\u009b", "\u202e", "\u2066", "\u202a", "\u2069", "\u0080", "\u009f", "\u2028", "\u2029"]) expect(isAttachmentName(`a${c}b.png`), JSON.stringify(c)).toBe(false);
  for (const n of ["a\u200eb.png", "a\u200fb.png", "صورة.png", "תמונה.png", "图片.png", "😀.png", "é\u00a0à.png"]) expect(isAttachmentName(n), n).toBe(true);
});

test("safeName shows each forbidden character as U+FFFD and cuts to 200", () => {
  expect(safeName("evil\u202egnp\u009b[31m/\\\n.exe")).toBe("evil\ufffdgnp\ufffd[31m\ufffd\ufffd\ufffd.exe");
  expect(safeName("a.png")).toBe("a.png");
  expect(safeName("a\u200eb")).toBe("a\u200eb");
  expect(safeName("a".repeat(300))).toHaveLength(200);
});
