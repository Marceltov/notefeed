// Per-IP rate limit for POST. In-memory, fixed one-minute windows.
const WINDOW = 60_000;
const hits = new Map<string, { start: number; count: number }>();

// Next 16 has no request.ip, and base-server only fills x-forwarded-for from the socket when the
// client did not send one (`??=`), so the header is spoofable. Trust it only behind a proxy.
// ponytail: without a proxy everyone shares one bucket; set NOTEFEED_TRUST_PROXY=1 behind one for per-IP limits.
export function clientIp(headers: Headers): string {
  if (process.env.NOTEFEED_TRUST_PROXY !== "1") return "direct";
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || "direct";
}

// Seconds to wait, or null if allowed.
export function rateLimit(ip: string, now = Date.now()): number | null {
  const raw = process.env.NOTEFEED_RATE_LIMIT;
  const max = raw === undefined || raw === "" || !Number.isFinite(Number(raw)) ? 60 : Number(raw);
  if (max <= 0) return null;
  for (const [k, v] of hits) if (now - v.start >= WINDOW) hits.delete(k);
  const e = hits.get(ip);
  if (!e) {
    hits.set(ip, { start: now, count: 1 });
    return null;
  }
  if (e.count < max) {
    e.count++;
    return null;
  }
  return Math.max(1, Math.ceil((e.start + WINDOW - now) / 1000));
}

export const resetRateLimitsForTests = () => hits.clear();
