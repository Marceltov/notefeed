import { expect, test, type Browser, type Page } from "@playwright/test";

const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function post(page: Page, name: string, markdown = "# A note", password?: string) {
  await page.goto(`/${name}`);
  if (password) await page.getByLabel("Password (optional, protects this feed)").fill(password);
  await page.getByLabel("Note in markdown").fill(markdown);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: markdown.replace(/^# /, "") })).toBeVisible();
}

async function setDetails(page: Page, title: string, description: string) {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Description").fill(description);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
}

test("title and description show on the feed page, the read-only view and in the RSS", async ({ page, request }) => {
  const name = feedName();
  await post(page, name);
  await setDetails(page, "My ideas", "Things I think about");
  await expect(page).toHaveURL(/\/settings\?saved=1$/);
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name: "My ideas" })).toBeVisible();
  await expect(page.getByText("Things I think about")).toBeVisible();
  await expect(page.getByRole("link", { name })).toBeVisible(); // the name stays visible
  await expect(page).toHaveTitle(/My ideas/);

  await page.getByRole("link", { name: "Open read-only view" }).click();
  await expect(page.getByRole("heading", { name: "My ideas" })).toBeVisible();
  await expect(page.getByText("Things I think about")).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
  const rss = await request.get((await page.getByRole("link", { name: "RSS" }).getAttribute("href"))!);
  const xml = await rss.text();
  expect(xml).toContain("My ideas");
  expect(xml).toContain("Things I think about");
});

test("a refused title says why, on the settings page", async ({ page }) => {
  const name = feedName();
  await post(page, name);
  const refusal = "The title, description, name or read link has characters that aren't allowed or is too long, or this instance doesn't let you choose them.";
  // With JavaScript: the API refuses a tab, and the form shows it.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Title").fill("a\tb");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: refusal })).toBeVisible();
  // Without: where the plain forms' redirects land.
  await page.goto(`/${name}/settings?form=details&error=invalid_body`);
  await expect(page.getByRole("alert").filter({ hasText: refusal })).toBeVisible();
  await expect(page.locator("#compose-error")).toHaveCount(0); // the compose box lives on the feed page
  await page.goto(`/${name}/settings?form=details&error=invalid_request`);
  await expect(page.getByRole("alert").filter({ hasText: "Type the feed's name" })).toHaveText("Type the feed's name to confirm.");
});

test("delete by typing the name lands on the home page; the feed and its read link are empty", async ({ page }) => {
  const name = feedName();
  await post(page, name);
  const readHref = await page.getByRole("link", { name: "Open read-only view" }).getAttribute("href");
  await page.getByRole("link", { name: "Settings" }).click();
  const button = page.getByRole("button", { name: "Delete feed" });
  await expect(button).toBeDisabled();
  await page.getByLabel("Feed name").fill(name.slice(0, -1));
  await expect(button).toBeDisabled();
  await page.getByLabel("Feed name").fill(name);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page).toHaveURL(/\/\?deleted=/);
  await expect(page.getByRole("status")).toHaveText("Feed deleted.");
  await page.goto(`/${name}`);
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await page.goto(readHref!);
  await expect(page.getByText("No notes yet.")).toBeVisible();
});

test("a locked feed's page does not contain its title", async ({ page, browser, baseURL }) => {
  const name = feedName();
  await post(page, name, "# Secret note", "hunter2");
  await setDetails(page, "Hidden title", "Hidden description");
  const other = await (await browser.newContext({ baseURL })).newPage();
  await other.goto(`/${name}`);
  await expect(other.getByRole("button", { name: "Unlock" })).toBeVisible();
  const html = await other.content();
  expect(html).not.toContain("Hidden title");
  expect(html).not.toContain("Hidden description");
});

test("deleting a protected feed works for the unlocked browser", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Secret note", "hunter2");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Feed name").fill(name);
  await page.getByRole("button", { name: "Delete feed" }).click();
  await expect(page.getByRole("status")).toHaveText("Feed deleted.");
  await page.goto(`/${name}`);
  await expect(page.getByLabel("Note in markdown")).toBeVisible(); // a new, open feed again
});

test("a refused save says why", async ({ page }) => {
  const name = feedName();
  await post(page, name);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.route("**/api/v1/feeds/*", (route) => route.fulfill({ status: 429, headers: { "retry-after": "7" }, json: { error: "slow down", code: "rate_limited" } }));
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "seconds" })).toContainText("Too many requests, try again in 7 seconds.");
});

test("without JavaScript, settings and delete still work", async ({ browser, baseURL }: { browser: Browser; baseURL?: string }) => {
  const page = await (await browser.newContext({ baseURL, javaScriptEnabled: false })).newPage();
  const name = feedName();
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill("# Plain note");
  await page.getByRole("button", { name: "Post note" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Title").fill("Plain title");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/settings\?saved=1$/);
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name: "Plain title" })).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();

  await page.getByLabel("Feed name").fill(name);
  await page.getByRole("button", { name: "Delete feed" }).click();
  await expect(page).toHaveURL(/\/\?deleted=/);
  await expect(page.getByRole("status")).toHaveText("Feed deleted.");
});

test("a feed can be renamed and given a read id of its own; the old links answer 404", async ({ page, request }) => {
  const name = feedName();
  const renamed = `${name}-renamed`;
  const readId = `read-${name}`;
  await post(page, name);
  await page.getByRole("link", { name: "Settings" }).click();
  const oldReadUrl = await page.locator("code", { hasText: "/r/" }).innerText();
  await page.getByLabel("Name (what you post to)").fill(renamed);
  await page.getByLabel("Read link id").fill(readId);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(new RegExp(`/${renamed}/settings\\?saved=1$`));
  await expect(page.locator("code", { hasText: `/r/${readId}/feed.xml` })).toBeVisible();
  await expect((await request.get(`/${name}`)).status()).toBe(404);
  await expect((await request.get(oldReadUrl.replace(/^https?:\/\/[^/]+/, ""))).status()).toBe(404);
  await expect((await request.get(`/r/${readId}/feed.xml`)).status()).toBe(200);
  await expect((await request.post(`/${name}`, { data: "# New" , headers: { "content-type": "text/markdown" } })).status()).toBe(404); // not created again
  await page.getByRole("button", { name: "Generate a random one" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByLabel("Read link id")).not.toHaveValue(readId);
});
