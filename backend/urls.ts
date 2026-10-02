// URLs the backend hands out. Read-side paths go through the read id only, never the (writable) feed name.
import { config } from "./config";

// Absolute base URL for links in the feed and API responses. X-Forwarded-* only behind a trusted proxy,
// like clientIp(): a cache keyed on Host would otherwise serve links to whatever host a client sent.
export function publicUrl(headers: Headers): string {
  const fixed = config.publicUrl();
  if (fixed) return fixed;
  const first = (name: string) => headers.get(name)?.split(",")[0].trim();
  const fwd = (name: string) => (config.trustProxy() ? first(name) : undefined);
  const proto = fwd("x-forwarded-proto") ?? "http";
  const host = fwd("x-forwarded-host") ?? first("host") ?? "localhost";
  return `${proto}://${host}`;
}

export const API_PREFIX = "/api/v1";
export const feedPath = (feed: string) => `/${feed}`;
export const readPath = (readId: string) => `/r/${readId}`;
export const rssPath = (readId: string) => `${readPath(readId)}/feed.xml`;

// Where to go after login: a same-origin path, else "/". A second "/" or any "\" would make it
// protocol-relative (browsers read "\" as "/"), and browsers drop tabs and newlines, so "/\t/x" is "//x".
export const safeNext = (v: unknown): string =>
  typeof v === "string" && /^\/(?![/\\])[^\\\x00-\x1f\x7f]*$/.test(v) ? v : "/";

export const mcpResource = (h: Headers) => `${publicUrl(h)}/mcp`;
