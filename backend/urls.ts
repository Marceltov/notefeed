// URLs the backend hands out. Read-side paths go through the read id only, never the (writable) feed name.
import { config } from "./config";

// Absolute base URL for links in the feed and API responses.
export function publicUrl(headers: Headers): string {
  const fixed = config.publicUrl();
  if (fixed) return fixed;
  const first = (name: string) => headers.get(name)?.split(",")[0].trim();
  const proto = first("x-forwarded-proto") ?? "http";
  const host = first("x-forwarded-host") ?? first("host") ?? "localhost";
  return `${proto}://${host}`;
}

export const feedPath = (feed: string) => `/${feed}`;
export const readPath = (readId: string) => `/r/${readId}`;
export const rssPath = (readId: string) => `${readPath(readId)}/feed.xml`;

// Where to go after login: a same-origin path, else "/". A second "/" or any "\" would make it
// protocol-relative (browsers read "\" as "/"), and browsers drop tabs and newlines, so "/\t/x" is "//x".
export const safeNext = (v: unknown): string =>
  typeof v === "string" && /^\/(?![/\\])[^\\\x00-\x1f\x7f]*$/.test(v) ? v : "/";
