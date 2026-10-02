import { readFileSync } from "node:fs";
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
  await page.getByLabel("Title", { exact: true }).fill("Typed, not saved"); // choosing an image keeps what is typed
  await choose(page, "Choose image", PNG);
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Typed, not saved");
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

// A paste event as a browser makes it: a clipboard holding the fixture PNG, and `text` when given.
async function paste(page: Page, text?: string) {
  const png = readFileSync(PNG).toString("base64");
  await page.getByLabel("Note in markdown").evaluate(
    (ta, { png, text }) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], "clip.png", { type: "image/png" }));
      if (text) data.setData("text/plain", text);
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
    { png, text },
  );
}

test("pasting an image uploads it and inserts its markdown", async ({ page }) => {
  await post(page, feedName(), "# Pasting");
  await paste(page);
  await expect(page.getByLabel("Note in markdown")).toHaveValue(SRC);
});

test("pasting a clipboard that also holds text uploads nothing", async ({ page }) => {
  await post(page, feedName(), "# Pasting text");
  const uploads: string[] = [];
  page.on("request", (r) => r.url().includes("/images") && uploads.push(r.url()));
  await paste(page, "copied cells");
  await page.waitForTimeout(500);
  expect(uploads).toEqual([]);
  await expect(page.getByLabel("Note in markdown")).toHaveValue("");
});

test("posting is held back while an image uploads", async ({ page }) => {
  await post(page, feedName(), "# Busy");
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/images", async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByLabel("Note in markdown").fill("# Waits for its image");
  await paste(page);
  await expect(page.getByRole("button", { name: "Post note" })).toBeDisabled();
  await page.getByLabel("Note in markdown").press("Control+Enter");
  release();
  await expect(page.getByLabel("Note in markdown")).toHaveValue(SRC);
  await expect(page.getByRole("link", { name: "Waits for its image" })).toHaveCount(0); // nothing was posted without the image
  await expect(page.getByRole("button", { name: "Post note" })).toBeEnabled();
});
