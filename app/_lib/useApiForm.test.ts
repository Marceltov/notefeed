import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { multipartBody } from "./useApiForm";

const png = readFileSync("e2e/fixtures/pixel.png");

test("multipartBody: the text as a text/markdown file part, byte for byte", async () => {
  const form = await multipartBody("# Hi\n\n![](a.png)\n", []);
  const text = form.get("text") as File;
  expect(text.type).toBe("text/markdown");
  expect(await text.text()).toBe("# Hi\n\n![](a.png)\n"); // no \r: a file part keeps its line breaks
  expect(form.getAll("file")).toEqual([]);
});

test("multipartBody: one file part per picture, named by its token, of the type its bytes say", async () => {
  const form = await multipartBody("x", [
    { token: "a.png", file: new File([png], "orig.png", { type: "image/png" }) },
    { token: "b.jpg", file: new File([png], "b.jpg", { type: "image/jpeg" }) }, // a PNG named .jpg
  ]);
  const files = form.getAll("file") as File[];
  expect(files.map((f) => [f.name, f.type])).toEqual([
    ["a.png", "image/png"],
    ["b.jpg", "image/png"],
  ]);
  expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(new Uint8Array(png));
  expect([...form.keys()].filter((k) => k.startsWith("alt."))).toEqual([]);
});

test("multipartBody: no text part for no text; alt fields only when given", async () => {
  const form = await multipartBody(undefined, [{ token: "a.png", file: new File([png], "a.png") }], { "a.png": "a pixel" });
  expect(form.has("text")).toBe(false);
  expect(form.get("alt.a.png")).toBe("a pixel");
});
