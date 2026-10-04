import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { pendingBody } from "./usePendingImages";

const png = readFileSync("e2e/fixtures/pixel.png");
const pic = (token: string) => ({ key: token, token, preview: "", file: new File([png], token, { type: "image/png" }) });

test("pendingBody: nothing waiting is no multipart body (the box posts raw)", async () => {
  expect(await pendingBody("# Hi", [])).toBeUndefined();
});

test("pendingBody: the text and the pictures in one body", async () => {
  const form = (await pendingBody("# Hi\n![](a.png)", [pic("a.png"), pic("b.png")]))!;
  expect(await (form.get("text") as File).text()).toBe("# Hi\n![](a.png)");
  expect((form.getAll("file") as File[]).map((f) => f.name)).toEqual(["a.png", "b.png"]);
});

test("pendingBody: a box holding nothing but the pictures' references sends no text part", async () => {
  const form = (await pendingBody("![](a.png)\n", [pic("a.png")]))!;
  expect(form.has("text")).toBe(false);
  expect(form.getAll("file")).toHaveLength(1);
});

test("pendingBody: a box holding only pictures sends each one's alt text, the first non-empty one when it is referred to twice", async () => {
  const form = (await pendingBody("![](a.png) ![a cat](a.png)\n![the dog](a.png)\n![](b.png)\n![two\nlines](c.png)", [pic("a.png"), pic("b.png"), pic("c.png")]))!;
  expect(form.has("text")).toBe(false);
  expect(form.get("alt.a.png")).toBe("a cat");
  expect(form.has("alt.b.png")).toBe(false);
  expect(form.get("alt.c.png")).toBe("two lines");
});

test("pendingBody: an alt text is one clean line of at most 500 characters", async () => {
  const form = (await pendingBody(`![a\u2028b ${"x".repeat(600)}](a.png)`, [pic("a.png")]))!;
  const alt = form.get("alt.a.png") as string;
  expect(alt.startsWith("a b x")).toBe(true);
  expect(Array.from(alt)).toHaveLength(500);
});

test("pendingBody: a note with text sends no alt fields (the alt text stays in the text)", async () => {
  const form = (await pendingBody("# Hi\n![a cat](a.png)", [pic("a.png")]))!;
  expect(form.has("alt.a.png")).toBe(false);
});
