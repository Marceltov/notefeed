import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import LoginPage from "./page";

beforeEach(() => {
  vi.stubEnv("NOTEFEED_OIDC_ISSUER", "https://idp.example");
  vi.stubEnv("NOTEFEED_OIDC_CLIENT_ID", "id");
  vi.stubEnv("NOTEFEED_OIDC_CLIENT_SECRET", "client-secret");
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "ann@x.com");
  vi.stubEnv("NOTEFEED_PASSWORD", "");
});
afterEach(() => vi.unstubAllEnvs());

const render = async (q: Record<string, string>) => renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(q) } as PageProps<"/login">));

test("a failed sign-in shows its message without a password form", async () => {
  const html = await render({ error: "sign_in_failed" });
  expect(html).not.toContain("<form");
  expect(html).toMatch(/<p id="login-error" role="alert"[^>]*>Sign-in didn&#x27;t work. Try again.<\/p>/);
});

test("with a password too, the message stays in the form, once", async () => {
  vi.stubEnv("NOTEFEED_PASSWORD", "pw");
  const html = await render({ error: "sign_in_failed" });
  expect(html.match(/id="login-error"/g)).toHaveLength(1);
  expect(html).toMatch(/<form[^]*id="login-error"[^]*<\/form>/);
});
