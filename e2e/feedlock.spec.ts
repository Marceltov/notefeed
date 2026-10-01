import { expect, test, type Browser, type Page } from "@playwright/test";

const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// A fresh browser context: no cookies, like another person.
const fresh = async (browser: Browser, baseURL: string | undefined) => (await browser.newContext({ baseURL })).newPage();

async function create(page: Page, name: string, password: string) {
  await page.goto(`/${name}`);
  await page.getByLabel("Password (optional, protects this feed)").fill(password);
  await page.getByLabel("Note in markdown").fill("# Secret note");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Secret note" })).toBeVisible();
}

async function unlock(page: Page, name: string, password: string) {
  await page.goto(`/${name}`);
  await page.getByLabel("Feed password").fill(password);
  await page.getByRole("button", { name: "Unlock" }).click();
}

test("a protected feed shows its unlock form to others, and the notes once unlocked", async ({ page, browser, baseURL }) => {
  const name = feedName();
  await create(page, name, "hunter2");
  const readHref = await page.getByRole("link", { name: "Open read-only view" }).getAttribute("href");

  const other = await fresh(browser, baseURL);
  await other.goto(`/${name}`);
  await expect(other.getByRole("button", { name: "Unlock" })).toBeVisible();
  await expect(other.getByText("Secret note")).toHaveCount(0);
  await expect(other.getByLabel("Note in markdown")).toHaveCount(0);
  await expect(other.getByText("Read link")).toHaveCount(0);

  await unlock(other, name, "wrong");
  await expect(other.locator("#unlock-error")).toHaveText("That password is wrong.");
  await unlock(other, name, "hunter2");
  await expect(other.getByRole("link", { name: "Secret note" })).toBeVisible();
  await expect(other.getByLabel("Note in markdown")).toBeVisible();
  await other.reload();
  await expect(other.getByRole("link", { name: "Secret note" })).toBeVisible();

  // The read link never needs the feed password.
  const anonymous = await fresh(browser, baseURL);
  await anonymous.goto(new URL(readHref!, page.url()).href);
  await expect(anonymous.getByRole("link", { name: "Secret note" })).toBeVisible();
});

test("the cookie belongs to one feed: unlocking foo does not unlock foobar", async ({ page, browser, baseURL }) => {
  const name = feedName();
  await create(page, name, "pw-one");
  const longer = `${name}bar`;
  await create(page, longer, "pw-two");
  const p = await fresh(browser, baseURL);
  await unlock(p, name, "pw-one");
  await expect(p.getByRole("link", { name: "Secret note" })).toBeVisible();
  await p.goto(`/${longer}`);
  await expect(p.getByRole("button", { name: "Unlock" })).toBeVisible();
});

test("change the password, then remove it", async ({ page, browser, baseURL }) => {
  const name = feedName();
  await create(page, name, "old-pw");

  await page.getByText("Feed password", { exact: true }).click();
  await page.getByLabel("Current password").fill("nope");
  await page.getByLabel("New password").fill("new-pw");
  await page.getByRole("button", { name: "Change" }).click();
  await expect(page.locator("#settings-error")).toHaveText("That password is wrong.");

  await page.getByLabel("Current password").fill("old-pw");
  await page.getByLabel("New password").fill("new-pw");
  await page.getByRole("button", { name: "Change" }).click();
  await expect(page.getByRole("link", { name: "Secret note" })).toBeVisible(); // this browser stays unlocked

  const other = await fresh(browser, baseURL);
  await unlock(other, name, "old-pw");
  await expect(other.locator("#unlock-error")).not.toBeEmpty();
  await unlock(other, name, "new-pw");
  await expect(other.getByRole("link", { name: "Secret note" })).toBeVisible();

  await page.getByText("Feed password", { exact: true }).click();
  await page.getByLabel("Current password").fill("new-pw");
  await page.getByRole("button", { name: "Remove password" }).click();
  await expect(page.getByRole("link", { name: "Secret note" })).toBeVisible();

  const third = await fresh(browser, baseURL);
  await third.goto(`/${name}`);
  await expect(third.getByRole("link", { name: "Secret note" })).toBeVisible();
});

test("Lock forgets the unlock in this browser", async ({ page }) => {
  const name = feedName();
  await create(page, name, "pw");
  await page.getByText("Feed password", { exact: true }).click();
  await page.getByRole("button", { name: "Lock" }).click();
  await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible();
});
