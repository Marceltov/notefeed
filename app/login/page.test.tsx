import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import LoginPage from "./page";

const providers = vi.hoisted(() => ({ list: [] as { id: string; label: string }[] | null }));
vi.mock("@/backend", async (orig) => {
  const real = await orig<typeof import("@/backend")>();
  return { ...real, signInProviders: () => providers.list ?? real.signInProviders() };
});

beforeEach(() => {
  providers.list = null;
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

const links = (html: string) => [...html.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1].replace(/&amp;/g, "&"), m[2]]);

test("one provider: one link, labelled from its host by default", async () => {
  expect(links(await render({ next: "/feed" }))).toEqual([["/api/oidc/start?provider=default&next=%2Ffeed", "Sign in with idp.example"]]);
});

test("a configured label wins over the host", async () => {
  vi.stubEnv("NOTEFEED_OIDC_LABEL", "Authentik");
  expect(links(await render({}))[0][1]).toBe("Sign in with Authentik");
});

test("two providers: two links in order, each naming its provider, one disclosure", async () => {
  providers.list = [{ id: "default", label: "Authentik" }, { id: "my_idp", label: "Work" }];
  const html = await render({ next: "/a b" });
  expect(links(html)).toEqual([
    ["/api/oidc/start?provider=default&next=%2Fa%20b", "Sign in with Authentik"],
    ["/api/oidc/start?provider=my_idp&next=%2Fa%20b", "Sign in with Work"],
  ]);
  expect(html.match(/text-muted/g)).toHaveLength(1);
});

test("an empty label reads just Sign in", async () => {
  providers.list = [{ id: "x", label: "" }];
  expect(links(await render({}))[0][1]).toBe("Sign in");
});

test("no provider: no link; password only is unchanged", async () => {
  providers.list = [];
  vi.stubEnv("NOTEFEED_PASSWORD", "pw");
  const html = await render({});
  expect(html).not.toContain("/api/oidc/start");
  expect(html).toContain('action="/login"');
});
