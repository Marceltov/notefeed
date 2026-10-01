import { expect, test } from "@playwright/test";

const feed = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test("login returns to the requested page, log out locks it again", async ({ page }) => {
  const name = feed();
  await page.goto(`/${name}`);
  await expect(page).toHaveURL(`/login?next=%2F${name}`);

  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#login-error")).not.toBeEmpty();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Password").fill("e2e");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(`/${name}`);
  await expect(page.getByLabel("Note in markdown")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await page.goto(`/${name}`);
  await expect(page).toHaveURL(/\/login/);
});

test("the read-only view needs no login", async ({ page, browser }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("/");
  await page.goto(`/${feed()}`);
  await page.getByLabel("Note in markdown").fill("# Public note");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Public note" })).toBeVisible();
  const readHref = await page.getByRole("link", { name: "Open read-only view" }).getAttribute("href");

  const anonymous = await browser.newPage();
  await anonymous.goto(new URL(readHref!, page.url()).href);
  await expect(anonymous.getByRole("link", { name: "Public note" })).toBeVisible();
  await expect(anonymous.getByRole("button", { name: "Log out" })).toHaveCount(0);
  await anonymous.close();
});
