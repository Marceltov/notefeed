// Absolute base URL for links in the feed and API responses.
export function publicUrl(headers: Headers): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const first = (name: string) => headers.get(name)?.split(",")[0].trim();
  const proto = first("x-forwarded-proto") ?? "http";
  const host = first("x-forwarded-host") ?? first("host") ?? "localhost";
  return `${proto}://${host}`;
}
