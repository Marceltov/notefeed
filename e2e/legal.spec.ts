// The imprint and the privacy page are the operator's own files. The "locked" server (port 3101) has both set, to the
// fixtures here; the "open" one (3100) has neither.
import { expect, test } from "@playwright/test";

const WITH = "http://localhost:3101";
const WITHOUT = "http://localhost:3100";

test("with the files set, both pages show them, need no login, and the footer links to them", async ({ page }) => {
  await page.goto(`${WITH}/imprint`);
  await expect(page).toHaveURL(`${WITH}/imprint`); // a locked instance, and no login asked
  await expect(page.getByRole("heading", { level: 1, name: "Imprint" })).toBeVisible();
  await expect(page.getByText("Jane Doe, Musterstraße 1, 12345 Musterstadt")).toBeVisible();
  await expect(page.getByRole("link", { name: "hello@example.com" })).toHaveAttribute("href", "mailto:hello@example.com");
  await expect(page).toHaveTitle(/Imprint/);
  // Raw HTML in the file is shown as text, never run.
  await expect(page.getByText("<script>window.fromTheFile = true</script>")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { fromTheFile?: boolean }).fromTheFile)).toBeUndefined();

  await page.getByRole("contentinfo").getByRole("link", { name: "Data privacy" }).click();
  await expect(page).toHaveURL(`${WITH}/privacy`);
  await expect(page.getByRole("heading", { level: 1, name: "Data privacy" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "until you delete the feed" })).toBeVisible();
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Imprint" })).toBeVisible();
});

test("without the files, neither page exists and the footer has no link to them", async ({ page, request }) => {
  for (const path of ["/imprint", "/privacy"]) expect((await request.get(WITHOUT + path)).status()).toBe(404);
  await page.goto(WITHOUT + "/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "Docs" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Imprint" })).toHaveCount(0);
  await expect(footer.getByRole("link", { name: "Data privacy" })).toHaveCount(0);
});

test("the two names cannot be taken as feeds", async ({ request }) => {
  for (const name of ["imprint", "privacy"]) {
    const res = await request.post(`${WITHOUT}/${name}`, { headers: { "Content-Type": "text/markdown" }, data: "# x" });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("reserved_feed");
  }
});
