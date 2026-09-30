// Per-IP rate limits for POST and for failed password attempts. In-memory, fixed one-minute windows.
const WINDOW = 60_000;
type Hits = Map<string, { start: number; count: number }>;
// Separate maps, so no IP string (spoofable behind NOTEFEED_TRUST_PROXY) can reach the other bucket.
const posts: Hits = new Map();
const failures: Hits = new Map();
let lastPrune = -Infinity;

// Next 16 has no request.ip, and base-server only fills x-forwarded-for from the socket when the
// client did not send one (`??=`), so the header is spoofable. Trust it only behind a proxy, and
// take the last entry: the address the proxy saw (an appending proxy keeps the client's own values in front).
// ponytail: without a proxy everyone shares one bucket; set NOTEFEED_TRUST_PROXY=1 behind one for per-IP limits.
export function clientIp(headers: Headers): string {
  if (process.env.NOTEFEED_TRUST_PROXY !== "1") return "direct";
  return headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "direct";
}

// Seconds to wait if `key` is over the limit, else null; `count` records this call.
function check(hits: Hits, key: string, now: number, count: boolean): number | null {
  const raw = process.env.NOTEFEED_RATE_LIMIT;
  const max = raw === undefined || raw === "" || !Number.isFinite(Number(raw)) ? 60 : Number(raw);
  if (max <= 0) return null;
  // Prune at most once per window, only to free memory; an expired entry is ignored below either way.
  if (now - lastPrune >= WINDOW) {
    lastPrune = now;
    for (const m of [posts, failures]) for (const [k, v] of m) if (now - v.start >= WINDOW) m.delete(k);
  }
  const found = hits.get(key);
  const e = found && now - found.start < WINDOW ? found : undefined; // set() below replaces an expired one
  if (e && e.count >= max) return Math.max(1, Math.ceil((e.start + WINDOW - now) / 1000));
  if (count) {
    if (e) e.count++;
    else hits.set(key, { start: now, count: 1 });
  }
  return null;
}

// Seconds to wait, or null if allowed (and counted).
export const rateLimit = (ip: string, now = Date.now()) => check(posts, ip, now, true);

// Failed password attempts, in their own bucket with the same limit: check before comparing, count only failures.
export const authWait = (ip: string, now = Date.now()) => check(failures, ip, now, false);
export const authFailed = (ip: string, now = Date.now()) => void check(failures, ip, now, true);

export const resetRateLimitsForTests = () => {
  posts.clear();
  failures.clear();
  lastPrune = -Infinity;
};
