import { expect, test } from "@playwright/test";
import { mcp } from "./mcp";

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

test("the read-only view and its RSS need no login", async ({ page, browser, request }) => {
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

  // `request` shares no cookies with `page`: an anonymous feed reader.
  const rss = await request.get(new URL(`${readHref}/feed.xml`, page.url()).href, { maxRedirects: 0 });
  expect(rss.status()).toBe(200);
  const link = /<item>.*?<link>(.*?)<\/link>/s.exec(await rss.text())![1];
  await anonymous.goto(link);
  await expect(anonymous.getByText("Public note")).toBeVisible();
  await anonymous.close();
});

test("MCP: /mcp wants the password as a bearer and points at the OAuth metadata", async ({ request }) => {
  const anon = await request.post("/mcp", mcp("tools/list"));
  expect(anon.status()).toBe(401);
  expect(anon.headers()["www-authenticate"]).toBe('Bearer resource_metadata="http://localhost:3101/.well-known/oauth-protected-resource/mcp"');
  expect((await request.post("/mcp", mcp("tools/list", {}, { authorization: "Bearer wrong" }))).status()).toBe(401);
  expect((await request.post("/mcp", mcp("tools/list", {}, { authorization: "Bearer e2e" }))).status()).toBe(200);

  const resource = await request.get("/.well-known/oauth-protected-resource/mcp");
  expect(resource.status()).toBe(200);
  expect((await resource.json()).resource).toBe("http://localhost:3101/mcp");
  const server = await request.get("/.well-known/oauth-authorization-server");
  expect(server.status()).toBe(200);
  expect((await server.json()).issuer).toBe("http://localhost:3101");
  expect(server.headers()["access-control-allow-origin"]).toBe("*");
  const preflight = await request.fetch("/oauth/register", { method: "OPTIONS" });
  expect(preflight.status()).toBe(204);
  expect(preflight.headers()["access-control-allow-methods"]).toBe("POST");
});

test("MCP: the OAuth login page, then the redirect with a code", async ({ page, request }) => {
  const redirect = "http://localhost:3101/cb";
  const reg = await request.post("/oauth/register", { data: { client_name: "E2E client", redirect_uris: [redirect] } });
  expect(reg.status()).toBe(201);
  const { client_id } = await reg.json();

  const params = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirect,
    // The challenge isn't checked until the token request, so any 43 base64url characters do.
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    state: "xyz",
  });
  const response = await page.goto(`/oauth/authorize?${params}`);
  expect(response!.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.getByRole("heading", { name: "Connect E2E client" })).toBeVisible();

  await page.getByLabel("Password").fill("e2e");
  // /cb is itself sent to /login by the proxy on a locked instance, so check the request, not the final page.
  const cb = page.waitForRequest((r) => r.url().startsWith(redirect));
  await page.getByRole("button", { name: "Allow" }).click();
  const url = new URL((await cb).url());
  expect(url.searchParams.get("code")).toBeTruthy();
  expect(url.searchParams.get("state")).toBe("xyz");
});
