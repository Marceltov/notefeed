import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AuthorizePage from "./page";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/backend", async (orig) => ({
  ...(await orig<typeof import("@/backend")>()),
  checkAuthorize: () => ({ kind: "page", clientName: "C", redirectHost: "c.example", fields: { client_id: "x" } }),
}));

beforeEach(() => {
  vi.stubEnv("NOTEFEED_OIDC_ISSUER", "https://idp.example");
  vi.stubEnv("NOTEFEED_OIDC_CLIENT_ID", "id");
  vi.stubEnv("NOTEFEED_OIDC_CLIENT_SECRET", "client-secret");
  vi.stubEnv("NOTEFEED_OIDC_ALLOW", "ann@x.com");
  vi.stubEnv("NOTEFEED_PASSWORD", "");
});
afterEach(() => vi.unstubAllEnvs());

const render = async (q: Record<string, string>) =>
  renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve(q) } as PageProps<"/oauth/authorize">));

test("a failed sign-in shows its message without a password form", async () => {
  const html = await render({ error: "too_many_attempts", retry: "9" });
  expect(html).not.toContain('action="/api/oauth/authorize"');
  expect(html).toMatch(/<p id="login-error" role="alert"[^>]*>[^<]*9 seconds[^<]*<\/p>/);
});

test("with a password too, the message stays in the password form, once", async () => {
  vi.stubEnv("NOTEFEED_PASSWORD", "pw");
  const html = await render({ error: "sign_in_failed" });
  expect(html.match(/id="login-error"/g)).toHaveLength(1);
  expect(html).toMatch(/action="\/api\/oauth\/authorize"[^]*id="login-error"[^]*<\/form>/);
});
