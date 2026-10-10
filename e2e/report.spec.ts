// The "Report" link on every note (issue #154): NOTEFEED_REPORT_URL on the open server (3100), unset on the locked one (3101).
import { expect, test, type Page } from "@playwright/test";

const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEMPLATE = /^https:\/\/report\.example\.com\/\?r=([A-Za-z0-9_-]+)&n=([A-Za-z0-9_-]+)&f=\2\.md$/;

async function post(page: Page, name: string, markdown: string) {
  await page.goto(`/${name}`);
  await page.getByLabel("Note in markdown").fill(markdown);
  await page.getByRole("button", { name: "Post note" }).click();
  await expect(page.getByRole("link", { name: markdown.replace(/^# /, "") })).toBeVisible();
}

test("the link is on the feed page, the note page, the read-only view and its note page, with the read id and the note id filled in", async ({ page }) => {
  const name = feedName();
  await post(page, name, "# Reportable");
  const onFeed = page.getByRole("link", { name: "Report", exact: true });
  await expect(onFeed).toHaveCount(1);
  const href = (await onFeed.getAttribute("href"))!;
  const m = TEMPLATE.exec(href)!;
  expect(m).not.toBeNull();
  const [, readId, noteId] = m;
  expect(href).not.toContain(name); // the read id, never the feed name
  await expect(onFeed).toHaveAttribute("rel", "nofollow noopener");

  await page.getByRole("link", { name: "Reportable" }).click();
  await expect(page.getByRole("link", { name: "Report", exact: true })).toHaveAttribute("href", href);

  await page.goto(`/r/${readId}`);
  await expect(page.getByRole("link", { name: "Report", exact: true })).toHaveAttribute("href", href);
  await page.goto(`/r/${readId}/${noteId}`);
  await expect(page.getByRole("link", { name: "Report", exact: true })).toHaveAttribute("href", href);
});

test("a picture's link carries its file name", async ({ page, request }) => {
  const name = feedName();
  await post(page, name, "# First");
  const posted = await request.post(`/api/v1/feeds/${name}/notes`, { headers: { "Content-Type": "image/png" }, data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) });
  expect(posted.status()).toBe(201);
  const { id, file } = await posted.json();
  await page.reload();
  const links = await page.getByRole("link", { name: "Report", exact: true }).evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  expect(links.some((l) => l.endsWith(`&n=${id}&f=${file}`))).toBe(true);
});

test("without NOTEFEED_REPORT_URL there is no link", async ({ request }) => {
  const name = feedName();
  const locked = "http://localhost:3101";
  const auth = { Authorization: "Bearer e2e" };
  const posted = await request.post(`${locked}/api/v1/feeds/${name}/notes`, { headers: { ...auth, "Content-Type": "text/markdown" }, data: "# Quiet" });
  expect(posted.status()).toBe(201);
  const readId = /\/r\/([^/]+)\//.exec((await posted.json()).read_url)![1];
  const html = await (await request.get(`${locked}/r/${readId}`)).text();
  expect(html).toContain("Quiet");
  expect(html).not.toContain(">Report<");
});
