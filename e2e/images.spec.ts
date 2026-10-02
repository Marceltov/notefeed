import { expect, test, type Page } from "@playwright/test";

const PNG = "e2e/fixtures/pixel.png";
const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SRC = /!\[\]\(http[^)]*\/r\/[^)]*\/images\/[0-9a-f]+\.png\)/;

async function post(page: Page, name: string, markdown: string) {
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill(markdown);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: markdown.replace(/^# /, "").split("\n")[0] })).toBeVisible();
}

async function choose(page: Page, button: string, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: button }).click();
  await (await chooser).setFiles(file);
}

const loaded = (page: Page) => expect.poll(() => page.locator(".md img").first().evaluate((i: HTMLImageElement) => i.naturalWidth));

test("a new feed offers no image button until its first note exists", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await expect(page.getByLabel("Note in markdown")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add image" })).toHaveCount(0);
});

test("an image added in the compose box shows on the feed page and in the read-only view", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# First");
  await page.getByLabel("Note in markdown").fill("# Pictured\n\nbefore");
  await choose(page, "Add image", PNG);
  await expect(page.getByLabel("Note in markdown")).toHaveValue(SRC);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.locator(".md img")).toBeVisible();
  await loaded(page).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page.locator(".md img")).toBeVisible();
  await loaded(page).toBeGreaterThan(0);
});

test("editing a note offers the same control", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Editable");
  await page.getByRole("link", { name: "Editable" }).click();
  await page.getByText("Edit", { exact: true }).click();
  await choose(page, "Add image", PNG);
  await expect(page.getByLabel("Note in markdown")).toHaveValue(SRC);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await loaded(page).toBeGreaterThan(0);
});

test("a title image shows in the header and the read-only view, and can be removed", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Titled");
  await page.getByText("Feed settings", { exact: true }).click();
  await choose(page, "Choose image", PNG);
  await expect(page.getByRole("status")).toHaveText("Saved.");
  const header = page.locator("header img");
  await expect(header).toBeVisible();
  expect(await header.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page.locator("header img")).toBeVisible();
  await page.goBack();
  await page.getByText("Feed settings", { exact: true }).click();
  await page.getByRole("button", { name: "Remove image" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.locator("header img")).toHaveCount(0);
  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page.locator("header img")).toHaveCount(0);
});

test("a text file chosen as an image is refused", async ({ page }) => {
  await post(page, feedName(), "# Refusing");
  await choose(page, "Add image", { name: "a.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(page.getByRole("alert").filter({ hasText: "Only PNG, JPEG, GIF and WebP" })).toBeVisible();
  await expect(page.getByLabel("Note in markdown")).toHaveValue("");
});
