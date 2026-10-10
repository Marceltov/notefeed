// NOTEFEED_IMAGE_UPLOADS=0 (issue #152), on the locked server: no image control in the note boxes, and every upload refused.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const PNG = "e2e/fixtures/pixel.png";
const OFF = "Images can't be posted on this instance.";
const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const note = (page: Page) => page.getByLabel("Note in markdown");

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("/");
}

test("the compose box and the editor show no Add image button and say why; a dropped file is refused; text still posts", async ({ page }) => {
  await login(page);
  const name = feedName();
  await page.goto(`/${name}`);
  await expect(note(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add image" })).toHaveCount(0);
  await expect(page.getByText(OFF)).toBeVisible();
  await note(page).fill("# Words only");
  const png = readFileSync(PNG).toString("base64");
  await note(page).evaluate((ta, png) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], "cat.png", { type: "image/png" }));
    ta.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  }, png);
  await expect(note(page)).toHaveValue("# Words only");
  await expect(page.locator("#compose-error")).toHaveText(OFF);
  await expect(page.getByRole("list", { name: "Images to post" })).toHaveCount(0);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Words only" })).toBeVisible();
  await page.getByRole("link", { name: "Words only" }).click();
  await page.getByText("Edit", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Add image" })).toHaveCount(0);
  await expect(page.getByText(OFF)).toBeVisible();
});

test("the API answers 403 images_off to a picture and to a note with pictures, and 201 to a text", async ({ request }) => {
  const name = feedName();
  const auth = { Authorization: "Bearer e2e" };
  const bytes = readFileSync(PNG);
  const picture = await request.post(`/api/v1/feeds/${name}/notes`, { headers: { ...auth, "Content-Type": "image/png" }, data: bytes });
  expect(picture.status()).toBe(403);
  expect((await picture.json()).code).toBe("images_off");
  const text = await request.post(`/api/v1/feeds/${name}/notes`, { headers: { ...auth, "Content-Type": "text/markdown" }, data: "# Text" });
  expect(text.status()).toBe(201);
  const withPictures = await request.post(`/api/v1/feeds/${name}/notes`, { headers: auth, multipart: { text: "# Hi ![](a.png)", file: { name: "a.png", mimeType: "image/png", buffer: bytes } } });
  expect(withPictures.status()).toBe(403);
  const listed = await (await request.get(`/api/v1/feeds/${name}/notes`, { headers: auth })).json();
  expect(listed.notes).toHaveLength(1);
});
