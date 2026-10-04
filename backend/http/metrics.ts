// GET /metrics: the Prometheus text format (backend/metrics.ts). Off (404) unless NOTEFEED_METRICS=1. With NOTEFEED_METRICS_TOKEN set it
// needs `Authorization: Bearer <token>`; without one it is open, which the startup log says. proxy.ts skips the lock for it:
// a scraper has no session, and the bearer is the credential.
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { renderMetrics } from "../metrics";

// Both sides hashed first, so the comparison takes the same time and works for tokens of any length.
const digest = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected));

export async function metricsRoute(req: Request): Promise<Response> {
  if (!config.metrics()) return new Response("not found", { status: 404 });
  const token = config.metricsToken();
  if (token) {
    const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
    if (!given || !sameToken(given, token)) return new Response("unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  const { contentType, body } = await renderMetrics();
  return new Response(body, { headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
}
