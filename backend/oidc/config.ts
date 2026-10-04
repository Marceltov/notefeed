// Optional OIDC sign-in, through one or more providers. The unprefixed NOTEFEED_OIDC_* variables are the provider
// "default"; each NOTEFEED_OIDC_<NAME>_* set is another, with id NAME lowercased (DEFAULT is reserved for the
// unprefixed set). A provider is on only when issuer, client id, client secret and a non-empty allow-list are all set.
// Must not import auth.ts (auth.ts imports this).
import { cleanLine } from "../../shared/links";
import { config } from "../config";

export type Provider = { id: string; label: string; issuer: string; clientId: string; clientSecret: string; allow: string[]; senderClaim: string[] };

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

// The variables a provider still needs to be on (none when it is), by name: NOTEFEED_OIDC_[<NAME>_]ISSUER, ...
export function missingVars(name: string): string[] {
  const c = config.oidc(name);
  const set = { ISSUER: c.issuer, CLIENT_ID: c.clientId, CLIENT_SECRET: c.clientSecret, ALLOW: c.allow.join(",") };
  return Object.entries(set).flatMap(([k, v]) => (v === "" ? [`NOTEFEED_OIDC_${name ? `${name}_` : ""}${k}`] : []));
}

function provider(id: string, name: string): Provider | undefined {
  const { label, ...c } = config.oidc(name);
  if (missingVars(name).length) return undefined;
  return { id, label: label || host(c.issuer), ...c };
}

// The ones that are on: default first, then the named ones by id (a stable button order).
export function providers(): Provider[] {
  const named = config.oidcNames().filter((n) => n !== "DEFAULT").map((n) => [n.toLowerCase(), n]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [["default", ""], ...named].flatMap(([id, name]) => provider(id, name) ?? []);
}

export const providerById = (id: string): Provider | undefined => providers().find((p) => p.id === id);

export const identityOn = (): boolean => providers().length > 0;

// `*` lets anyone the provider signs in through, even without an email claim; every other entry
// (address or @domain) needs a verified email.
export function allowed(provider: Pick<Provider, "allow">, c: { email?: string; email_verified?: boolean }): boolean {
  const { allow } = provider;
  if (allow.includes("*")) return true;
  if (c.email_verified !== true || !c.email) return false;
  const email = c.email.toLowerCase();
  return allow.some((a) => (a.startsWith("@") ? email.endsWith(a) : email === a));
}

// Who a note is from: the first of the claims, in the given order, that is a non-empty string (trimmed).
export function senderFrom(claims: Record<string, unknown>, order: string[]): string | undefined {
  for (const k of order) {
    const v = claims[k];
    if (typeof v === "string" && cleanLine(v)) return cleanLine(v); // a name from the provider is shown on notes: no control or text-direction override characters
  }
  return undefined;
}
