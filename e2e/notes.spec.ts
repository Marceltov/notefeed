import { expect, test, type Page } from "@playwright/test";

const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function postAndOpen(page: Page, name: string, markdown: string) {
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill(markdown);
  await page.getByRole("button", { name: "Post note" }).click();
  await page.getByRole("link", { name: markdown.replace(/^# /, "") }).click();
}

test("edit shows the new text on the note page and in the feed", async ({ page }) => {
  const name = feedName();
  await postAndOpen(page, name, "# First draft");
  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Note in markdown").fill("# Second draft");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByRole("heading", { name: "Second draft" })).toBeVisible();
  await page.getByRole("link", { name: "Back to all notes" }).click();
  await expect(page.getByRole("link", { name: "Second draft" })).toBeVisible();
  await expect(page.getByText("First draft")).toHaveCount(0);
});

test("a refused save keeps the text and says why", async ({ page }) => {
  await postAndOpen(page, feedName(), "# Keep me");
  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Note in markdown").fill("   ");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#note-actions-error")).toHaveText("The note is empty.");
  await expect(page.getByLabel("Note in markdown")).toHaveValue("   ");
});

test("delete lands on the feed without the note", async ({ page }) => {
  const name = feedName();
  await postAndOpen(page, name, "# Doomed");
  await page.getByText("Delete", { exact: true }).click();
  await expect(page.getByText("Delete this note? This can't be undone.")).toBeVisible();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page).toHaveURL(new RegExp(`/${name}\\?deleted=`));
  await expect(page.getByRole("status")).toHaveText("Note deleted.");
  await expect(page.getByText("Doomed")).toHaveCount(0);
});

test("deleting the only note leaves a feed that cannot be given a password", async ({ page }) => {
  await postAndOpen(page, feedName(), "# Only one");
  await page.getByText("Delete", { exact: true }).click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByRole("status")).toHaveText("Note deleted.");
  await expect(page.getByLabel("Note in markdown")).toBeVisible();
  await expect(page.getByLabel("Password (optional, protects this feed)")).toHaveCount(0);
});

test("Ctrl+Enter saves an edit", async ({ page }) => {
  await postAndOpen(page, feedName(), "# Quick");
  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Note in markdown").fill("# Quick edited");
  await page.getByLabel("Note in markdown").press("Control+Enter");
  await expect(page.getByRole("heading", { name: "Quick edited" })).toBeVisible();
});

test("the read-only view has no edit or delete", async ({ page }) => {
  const name = feedName();
  await postAndOpen(page, name, "# Read me");
  await page.getByRole("link", { name: "Back to all notes" }).click();
  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page).toHaveURL(/\/r\/[^/]+$/); // the feed page has a "Read me" link too: wait until it is the read-only one
  await page.getByRole("link", { name: "Read me" }).click();
  await expect(page).toHaveURL(/\/r\/[^/]+\/\d{8}T/);
  await expect(page.getByRole("heading", { name: "Read me" })).toBeVisible();
  await expect(page.getByText("Edit", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Delete", { exact: true })).toHaveCount(0);
});

test("tags typed in the compose box show as links that filter the feed", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill("# Tagged");
  await page.getByLabel("Tags (optional, separated by commas)").fill("CI, deploy");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Tagged" })).toBeVisible();
  await page.getByRole("link", { name: "ci", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${name}\\?tag=ci$`));
  await expect(page.getByText("Notes tagged")).toBeVisible();
  await expect(page.getByRole("link", { name: "Tagged" })).toBeVisible();
});

test("the browser refuses a tag with a space in it", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await page.getByLabel("Note in markdown").fill("# Nope");
  await page.getByLabel("Tags (optional, separated by commas)").fill("two words");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Nope" })).toHaveCount(0);
});
