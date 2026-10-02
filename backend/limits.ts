// Per-IP rate limits for POST and for failed password attempts. In-memory, fixed one-minute windows. Also the log
// line for the caps (NOTEFEED_MAX_*).
import { config } from "./config";
import { logger } from "./log";
import { processState } from "./state";

const WINDOW = 60_000;
type Hits = Map<string, { start: number; count: number }>;
// Separate maps, so no IP string (spoofable behind NOTEFEED_TRUST_PROXY) can reach the other bucket.
const state = processState("limits", () => ({ posts: new Map() as Hits, failures: new Map() as Hits, lastPrune: -Infinity }));
const { posts, failures } = state;
const log = logger("limits");

// A cap's error, logged on the way (without the feed's name).
export function capReached<E>(kind: "feed" | "note" | "image", e: E): E {
  log.warn({ kind }, "cap reached");
  return e;
}

// Next 16 has no request.ip, and base-server only fills x-forwarded-for from the socket when the
// client did not send one (`??=`), so the header is spoofable. Trust it only behind a proxy, and
// take the last entry: the address the proxy saw (an appending proxy keeps the client's own values in front).
// ponytail: without a proxy everyone shares one bucket; set NOTEFEED_TRUST_PROXY=1 behind one for per-IP limits.
export function clientIp(headers: Headers): string {
  if (!config.trustProxy()) return "direct";
  return headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "direct";
}

// Seconds to wait if `key` is over the limit, else null; `count` records this call.
function check(hits: Hits, key: string, now: number, count: boolean): number | null {
  const max = config.rateLimit();
  if (max <= 0) return null;
  // Prune at most once per window, only to free memory; an expired entry is ignored below either way.
  if (now - state.lastPrune >= WINDOW) {
    state.lastPrune = now;
    for (const m of [posts, failures]) for (const [k, v] of m) if (now - v.start >= WINDOW) m.delete(k);
  }
  const found = hits.get(key);
  const e = found && now - found.start < WINDOW ? found : undefined; // set() below replaces an expired one
  if (e && e.count >= max) {
    log.debug({ kind: hits === posts ? "post" : "password" }, "rate limit reached"); // never the IP
    return Math.max(1, Math.ceil((e.start + WINDOW - now) / 1000));
  }
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

// The same bucket, for a password check that awaits (scrypt): the attempt is counted before the check, or a
// burst of guesses would all pass authWait while the first ones are still hashing. Returns the seconds to
// wait if over the limit, else a function that gives this attempt back, to call when the password was right.
// It holds on to the window it counted in, so a window that began later is never touched.
// ponytail: checks still running count as failures, so more right passwords at once than the limit get a
// short 429 for the rest. Count running checks separately if that ever bites.
export function authAttempt(ip: string, now = Date.now()): number | (() => void) {
  const wait = check(failures, ip, now, true);
  if (wait !== null) return wait;
  const counted = failures.get(ip); // none when the limit is off
  return () => {
    if (counted && counted.count > 0) counted.count--;
  };
}

export const resetRateLimitsForTests = () => {
  posts.clear();
  failures.clear();
  state.lastPrune = -Infinity;
};
