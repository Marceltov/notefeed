import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AuthorizePage from "./page";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const providers = vi.hoisted(() => ({ list: null as { id: string; label: string }[] | null }));
vi.mock("@/backend", async (orig) => ({
  ...(await orig<typeof import("@/backend")>()),
  signInProviders: () => providers.list ?? [{ id: "default", label: "idp.example" }],
  checkAuthorize: () => ({ kind: "page", clientName: "C", redirectHost: "c.example", fields: { client_id: "x" } }),
}));

beforeEach(() => {
  providers.list = null;
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

const forms = (html: string) =>
  [...html.matchAll(/<form action="\/api\/oidc\/start" method="post">(.*?)<\/form>/g)].map((m) => ({
    provider: m[1].match(/name="provider" value="([^"]*)"/)?.[1],
    client: m[1].match(/name="client_id" value="([^"]*)"/)?.[1],
    button: m[1].match(/<button[^>]*>([^<]*)<\/button>/)?.[1],
  }));

test("one provider: one form with the authorize fields and its provider", async () => {
  expect(forms(await render({}))).toEqual([{ provider: "default", client: "x", button: "Sign in with idp.example" }]);
});

test("two providers: a form each, in order, one disclosure", async () => {
  providers.list = [{ id: "default", label: "Authentik" }, { id: "work", label: "Work" }];
  const html = await render({});
  expect(forms(html)).toEqual([
    { provider: "default", client: "x", button: "Sign in with Authentik" },
    { provider: "work", client: "x", button: "Sign in with Work" },
  ]);
  expect(html.match(/mt-2 text-sm text-muted/g)).toHaveLength(1);
});

test("an empty label reads just Sign in", async () => {
  providers.list = [{ id: "x", label: "" }];
  expect(forms(await render({}))[0].button).toBe("Sign in");
});

test("no provider: no form; password only is unchanged", async () => {
  providers.list = [];
  vi.stubEnv("NOTEFEED_PASSWORD", "pw");
  const html = await render({});
  expect(forms(html)).toEqual([]);
  expect(html).toContain('action="/api/oauth/authorize"');
});
