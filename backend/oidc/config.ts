// Optional OIDC sign-in: on only when issuer, client id, client secret and a non-empty allow-list are all set.
// Must not import auth.ts (auth.ts imports this).
import { config } from "../config";

export function identityOn(): boolean {
  const { issuer, clientId, clientSecret, allow } = config.oidc();
  return issuer !== "" && clientId !== "" && clientSecret !== "" && allow.length > 0;
}

// `*` lets anyone the provider signs in through, even without an email claim; every other entry
// (address or @domain) needs a verified email.
export function allowed(c: { email?: string; email_verified?: boolean }): boolean {
  const { allow } = config.oidc();
  if (allow.includes("*")) return true;
  if (c.email_verified !== true || !c.email) return false;
  const email = c.email.toLowerCase();
  return allow.some((a) => (a.startsWith("@") ? email.endsWith(a) : email === a));
}

// Who a note is from: the trimmed name, else the email.
export const senderFrom = (c: { name?: string; email?: string }): string | undefined => c.name?.trim() || c.email || undefined;
