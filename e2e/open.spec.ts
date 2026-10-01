import { expect, test, type Page } from "@playwright/test";

// A fresh feed per test, so tests don't see each other's notes.
const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function post(page: Page, markdown: string) {
  await page.getByLabel("Note in markdown").fill(markdown);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("listitem").first()).toContainText(markdown.split("\n")[0].replace(/^# /, ""));
}

test("start page normalizes the name and opens the feed", async ({ page }) => {
  const name = feedName();
  await page.goto("/");
  await page.getByLabel("Feed name").fill(`  ${name.toUpperCase().replace("-", " ")} `);
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(`/${name}`);
  await expect(page.getByText("No notes yet.")).toBeVisible();
});

test("start page rejects reserved and invalid names", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Feed name").fill("login");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.locator("#feed-error")).toHaveText("That name is reserved. Pick another.");

  await page.getByLabel("Feed name").fill("a/b");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.locator("#feed-error")).toHaveText("Use 1–64 characters: a–z, 0–9, - and _.");
});

test("posting with the button and with Ctrl+Enter puts the note on top", async ({ page }) => {
  await page.goto(`/${feedName()}`);
  await page.getByLabel("Note in markdown").fill("# Backup finished");
  await expect(page.getByText(/Saves as \d{8}T\d{6}Z-backup-finished\.md/)).toBeVisible();
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("listitem").first()).toContainText("Backup finished");

  await page.getByLabel("Note in markdown").fill("# Second note");
  await page.getByLabel("Note in markdown").press("Control+Enter");
  await expect(page.getByRole("listitem").first()).toContainText("Second note");
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByLabel("Note in markdown")).toHaveValue("");
});

test("a note opens on its own page, with raw HTML shown as text", async ({ page }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await post(page, "# Hello\n\n<b id=injected>bold?</b>");
  await page.getByRole("link", { name: "Hello" }).click();
  await expect(page).toHaveURL(new RegExp(`/${name}/\\d{8}T\\d{6}Z-hello$`));
  await expect(page.getByText("<b id=injected>bold?</b>")).toBeVisible();
  await expect(page.locator("#injected")).toHaveCount(0);
  await page.getByRole("link", { name: "Back to all notes" }).click();
  await expect(page).toHaveURL(`/${name}`);
});

test("the read link shows the notes but not the feed name, and serves RSS", async ({ page, request }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  await post(page, "# Shared note");

  // A full load, like a reader opening the link: a client-side navigation keeps the feed page's payload.
  await page.goto((await page.getByRole("link", { name: "Open read-only view" }).getAttribute("href"))!);
  await expect(page).toHaveURL(/\/r\/[A-Za-z0-9_-]{22}$/);
  await expect(page.getByRole("link", { name: "Shared note" })).toBeVisible();
  await expect(page.getByLabel("Note in markdown")).toHaveCount(0);
  expect(await page.content()).not.toContain(name);

  const rss = await request.get(`${page.url()}/feed.xml`);
  expect(rss.ok()).toBe(true);
  const xml = await rss.text();
  expect(xml).toContain("Shared note");
  expect(xml).not.toContain(name);
  expect(rss.headers()["content-type"]).toBe("application/rss+xml; charset=utf-8");

  // A feed reader follows the item's link: the note's read-only page, not the feed's.
  const link = /<item>.*?<link>(.*?)<\/link>/s.exec(xml)![1];
  expect(link).toMatch(/^http:\/\/localhost:3100\/r\/[A-Za-z0-9_-]{22}\/\d{8}T\d{6}Z-shared-note$/);
  await page.goto(link);
  await expect(page.getByText("Shared note")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to all notes" })).toBeVisible();
  expect(await page.content()).not.toContain(name);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the compose box is a plain form: posting and errors work", async ({ page }) => {
    const name = feedName();
    await page.goto(`/${name}`);
    await page.getByLabel("Note in markdown").fill("# Posted without JS");
    await page.getByRole("button", { name: "Post note" }).click();
    await expect(page).toHaveURL(new RegExp(`/${name}\\?posted=\\d{8}T\\d{6}Z-posted-without-js$`));
    await expect(page.getByRole("listitem").first()).toContainText("Posted without JS");

    await page.getByLabel("Note in markdown").fill("   ");
    await page.getByRole("button", { name: "Post note" }).click();
    await expect(page).toHaveURL(`/${name}?error=empty_note`);
    await expect(page.locator("#compose-error")).toHaveText("The note is empty.");
  });
});

test("the REST API: post with the short form, read back as JSON, by name and by read id", async ({ request }) => {
  const name = feedName();
  const created = await request.post(`/${name}`, { data: "# Via the API", headers: { "content-type": "text/markdown" } });
  expect(created.status()).toBe(201);
  const { id, read_url } = await created.json();

  const byName = await (await request.get(`/api/v1/feeds/${name}/notes?limit=1`)).json();
  expect(byName).toEqual({ notes: [expect.objectContaining({ id, title: "Via the API" })], next: null });

  const rid = new URL(read_url).pathname.split("/")[2];
  const byReadId = await request.get(`/api/v1/read/${rid}/notes/${id}`);
  expect((await byReadId.json()).markdown).toBe("# Via the API");
  expect(await byReadId.text()).not.toContain(name);

  const spec = await (await request.get("/api/v1/openapi.json")).json();
  expect(spec.paths).toHaveProperty("/api/v1/feeds/{feed}/notes");
});

test("the REST API answers unknown paths and methods in JSON, not with Next's pages", async ({ request }) => {
  const unknown = await request.get("/api/v1/nope");
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toEqual({ error: "no such endpoint", code: "not_found" });
  const put = await request.put("/api/v1/openapi.json");
  expect(put.status()).toBe(405);
  expect(put.headers()["allow"]).toBe("GET, HEAD");
  expect(await put.json()).toEqual({ error: "method not allowed" });
  expect((await request.head("/api/v1/openapi.json")).status()).toBe(200);
});
