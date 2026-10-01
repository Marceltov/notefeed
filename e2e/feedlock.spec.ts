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

test("a second note posts from the compose box, with a fresh unlock too", async ({ page, browser, baseURL }) => {
  const name = feedName();
  await create(page, name, "pw");
  await page.getByLabel("Note in markdown").fill("# Second note");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: "Second note" })).toBeVisible();

  const other = await fresh(browser, baseURL);
  await unlock(other, name, "pw");
  await other.getByLabel("Note in markdown").fill("# Third note");
  await other.getByRole("button", { name: "Post note" }).click();
  await expect(other.getByRole("link", { name: "Third note" })).toBeVisible();
  await expect(other.getByRole("link", { name: "Secret note" })).toBeVisible();
});

test("a 401 from the compose box lands on the feed's unlock form, not /login", async ({ page }) => {
  const name = feedName();
  await create(page, name, "pw");
  await page.context().clearCookies();
  await page.getByLabel("Note in markdown").fill("# Too late");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible();
  await expect(page).toHaveURL(`/${name}`);
});

test("a script posts and reads with X-Feed-Password, and is refused without it", async ({ page, request }) => {
  const name = feedName();
  await create(page, name, "pw");
  const text = { "content-type": "text/markdown" };
  expect((await request.post(`/${name}`, { data: "# No password", headers: text })).status()).toBe(401);
  expect((await request.post(`/${name}`, { data: "# Wrong", headers: { ...text, "x-feed-password": "nope" } })).status()).toBe(401);
  expect((await request.post(`/${name}`, { data: "# From a script", headers: { ...text, "x-feed-password": "pw" } })).status()).toBe(201);
  expect((await request.get(`/api/v1/feeds/${name}/notes`)).status()).toBe(401);
  const list = await request.get(`/api/v1/feeds/${name}/notes`, { headers: { "x-feed-password": "pw" } });
  // Sorted: two notes of the same second are ordered by title, not by arrival.
  expect((await list.json()).notes.map((n: { title: string }) => n.title).sort()).toEqual(["From a script", "Secret note"]);
});

test("a password that could not be sent in a header is refused by the form", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await page.getByLabel("Password (optional, protects this feed)").fill("pässwort");
  await page.getByLabel("Note in markdown").fill("# Secret note");
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByLabel("Password (optional, protects this feed)")).toHaveJSProperty("validity.patternMismatch", true);
  await page.reload();
  await expect(page.getByText("No notes yet")).toBeVisible();
});

test("an unlocked browser edits and deletes a note through the API, with the feed cookie", async ({ page, browser, baseURL }) => {
  const name = feedName();
  await create(page, name, "pw-edit");
  const other = await fresh(browser, baseURL);
  await unlock(other, name, "pw-edit");
  await other.getByRole("link", { name: "Secret note" }).click();
  await other.getByText("Edit", { exact: true }).click();
  await other.getByLabel("Note in markdown").fill("# Edited secret");
  const sent = other.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname.startsWith(`/api/v1/feeds/${name}/notes/`));
  await other.getByRole("button", { name: "Save" }).click();
  expect((await sent).status()).toBe(200);
  await expect(other.getByRole("heading", { name: "Edited secret" })).toBeVisible();

  await other.getByText("Delete", { exact: true }).click();
  const deleted = other.waitForResponse((r) => r.request().method() === "DELETE");
  await other.getByRole("button", { name: "Delete note" }).click();
  expect((await deleted).status()).toBe(204);
  await expect(other.getByRole("status")).toHaveText("Note deleted.");
  // Still protected after the last note is gone.
  const stranger = await fresh(browser, baseURL);
  await stranger.goto(`/${name}`);
  await expect(stranger.getByRole("button", { name: "Unlock" })).toBeVisible();
});
