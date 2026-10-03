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
