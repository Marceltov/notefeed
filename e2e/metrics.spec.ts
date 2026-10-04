import { expect, test } from "@playwright/test";

// A fresh feed per test, so tests don't see each other's notes.
const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test("a scrape after a feed read shows the request histogram, and no feed name", async ({ page, request }) => {
  const name = feedName();
  await page.goto(`/${name}`);
  const res = await request.get("/metrics");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");
  const body = await res.text();
  expect(body).toMatch(/notefeed_request_duration_seconds_count\{[^}]*kind="feed_page"/);
  expect(body).toContain("notefeed_process_cpu_user_seconds_total");
  expect(body).not.toContain(name);
});

test("a feed named metrics cannot be created: the name is the scrape route's", async ({ request }) => {
  const res = await request.post("/metrics", { data: "x", headers: { "content-type": "text/plain" } });
  expect(res.status()).toBe(405);
});
