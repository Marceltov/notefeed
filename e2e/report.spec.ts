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

// The built-in report page (issue #156): /report posts to NOTEFEED_REPORT_ENDPOINT, a stand-in for the operator's inbox
// here, and shows its answer; the ids come from the link. Without an endpoint (the locked server) there is no page.
import { createServer, type Server } from "node:http";

const received: { url: string; type: string | undefined; body: string }[] = [];
let inbox: Server;
test.beforeAll(async () => {
  inbox = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ url: req.url ?? "", type: req.headers["content-type"], body });
      const cors = { "access-control-allow-origin": "http://localhost:3100", "content-type": "application/json" };
      if (req.method === "OPTIONS") return res.writeHead(204, { ...cors, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" }).end();
      const data = JSON.parse(body || "{}") as Record<string, string>;
      if (!data.reason) res.writeHead(400, cors).end(JSON.stringify({ errors: ["Reason is required"] }));
      else res.writeHead(201, cors).end(JSON.stringify({ id: "abc" }));
    });
  });
  await new Promise<void>((r) => inbox.listen(3198, "127.0.0.1", r));
});
test.afterAll(() => new Promise<void>((r) => inbox.close(() => r())));

test("the report page posts to the inbox with the note's ids and shows the answer", async ({ page }) => {
  await page.goto("/report?read_id=r1d&note_id=20260930T100000Z-abc&file=20260930T100000Z-abc.md");
  await expect(page.getByRole("heading", { level: 1, name: "Report a note" })).toBeVisible();
  await expect(page.locator('input[name="read_id"]')).toHaveValue("r1d");
  await expect(page.locator("form")).toHaveAttribute("action", "http://127.0.0.1:3198/f/notefeed-report");

  // Refused by the inbox (the browser's own check is skipped): the answer is shown, the text stays.
  await page.getByLabel("What is wrong").fill("This note shows my address.");
  await page.getByLabel("Reason").evaluate((el) => el.removeAttribute("required"));
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.locator("ul[role=alert]")).toContainText("Reason is required");
  await expect(page.getByLabel("What is wrong")).toHaveValue("This note shows my address.");

  await page.getByLabel("Reason").selectOption("Personal data");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("status")).toContainText("Report sent");
  const last = received.at(-1)!;
  expect(last.url).toBe("/f/notefeed-report");
  expect(last.type).toBe("application/json");
  expect(JSON.parse(last.body)).toMatchObject({ read_id: "r1d", note_id: "20260930T100000Z-abc", file: "20260930T100000Z-abc.md", reason: "Personal data", text: "This note shows my address.", email: "", _gotcha: "" });
});

test("the inbox's redirects land on the page: sent, or back with the errors and what was typed", async ({ page }) => {
  await page.goto("/report?sent=1");
  await expect(page.getByRole("heading", { level: 1, name: "Report sent" })).toBeVisible();
  await page.goto("/report?read_id=r1d&text=Only+text&error=Reason+is+required");
  await expect(page.locator("ul[role=alert]")).toContainText("Reason is required");
  await expect(page.getByLabel("What is wrong")).toHaveValue("Only text");
  await expect(page.locator('input[name="read_id"]')).toHaveValue("r1d");
});

test("without NOTEFEED_REPORT_ENDPOINT there is no page", async ({ request }) => {
  expect((await request.get("http://localhost:3101/report", { maxRedirects: 0 })).status()).toBe(404);
});
