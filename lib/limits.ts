// Per-IP rate limits for POST and for failed password attempts. In-memory, fixed one-minute windows.
const WINDOW = 60_000;
const hits = new Map<string, { start: number; count: number }>();

// Next 16 has no request.ip, and base-server only fills x-forwarded-for from the socket when the
// client did not send one (`??=`), so the header is spoofable. Trust it only behind a proxy.
// ponytail: without a proxy everyone shares one bucket; set NOTEFEED_TRUST_PROXY=1 behind one for per-IP limits.
export function clientIp(headers: Headers): string {
  if (process.env.NOTEFEED_TRUST_PROXY !== "1") return "direct";
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || "direct";
}

// Seconds to wait if `key` is over the limit, else null; `count` records this call.
function check(key: string, now: number, count: boolean): number | null {
  const raw = process.env.NOTEFEED_RATE_LIMIT;
  const max = raw === undefined || raw === "" || !Number.isFinite(Number(raw)) ? 60 : Number(raw);
  if (max <= 0) return null;
  for (const [k, v] of hits) if (now - v.start >= WINDOW) hits.delete(k);
  const e = hits.get(key);
  if (e && e.count >= max) return Math.max(1, Math.ceil((e.start + WINDOW - now) / 1000));
  if (count) {
    if (e) e.count++;
    else hits.set(key, { start: now, count: 1 });
  }
  return null;
}

// Seconds to wait, or null if allowed (and counted).
export const rateLimit = (ip: string, now = Date.now()) => check(ip, now, true);

// Failed password attempts, in their own bucket with the same limit: check before comparing, count only failures.
export const authWait = (ip: string, now = Date.now()) => check(`auth:${ip}`, now, false);
export const authFailed = (ip: string, now = Date.now()) => void check(`auth:${ip}`, now, true);

export const resetRateLimitsForTests = () => hits.clear();
