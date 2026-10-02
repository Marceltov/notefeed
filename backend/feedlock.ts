// Optional per-feed password: DATA_DIR/<feed>/.password holds a scrypt hash, set only when the feed is created.
// Unprotected feeds (no file) pass every check. The file is read per request, so deleting it unlocks at once.
import { createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";
import { PASSWORD_PATTERN, PASSWORD_RULE } from "../shared/password";
import { isErrno } from "./data/fs";
import { readHash, removeHash, writeHash } from "./data/password";
import { AuthError, FeedExistsError, InvalidBodyError, NotFoundError, TooManyAttemptsError } from "./errors";
import { checkFeed, createProtectedFeed, secret } from "./feeds";
import { authAttempt } from "./limits";

// An empty password means none, wherever it comes from (header, body field, MCP argument).
export type FeedAccess = { password?: string; cookie?: string };

export const feedCookieName = (feed: string) => `nf_feed_${feed}`;

const PASSWORD_RE = new RegExp(`^(?:${PASSWORD_PATTERN})$`);

export function checkNewPassword(p: string): void {
  if (!PASSWORD_RE.test(p)) throw new InvalidBodyError(`password must be ${PASSWORD_RULE}`);
}

const N = 16384, R = 8, P = 1, KEYLEN = 64;
// The async scrypt runs on the thread pool: a password check (some 40 ms) must not stall every other request.
const scryptAsync = promisify<string, Buffer, number, ScryptOptions, Buffer>(scrypt);
const derive = (p: string, salt: Buffer, n: number, r: number, pp: number, len: number) =>
  scryptAsync(p, salt, len, { N: n, r, p: pp, maxmem: 128 * n * r * 2 });

// scrypt$N$r$p$salt$hash (base64), so the parameters can change later without breaking stored hashes.
export async function hashPassword(p: string): Promise<string> {
  const salt = randomBytes(16);
  return ["scrypt", N, R, P, salt.toString("base64"), (await derive(p, salt, N, R, P, KEYLEN)).toString("base64")].join("$");
}

export async function verifyHash(p: string, hash: string): Promise<boolean> {
  const [tag, n, r, pp, salt, key] = hash.split("$");
  if (tag !== "scrypt" || !key) return false;
  try {
    const want = Buffer.from(key, "base64");
    const got = await derive(p, Buffer.from(salt, "base64"), +n, +r, +pp, want.length);
    return want.length > 0 && timingSafeEqual(got, want);
  } catch {
    return false; // malformed or absurd parameters
  }
}

export async function protectedFeed(feed: string): Promise<boolean> {
  return (await readHash(feed)) !== null;
}

const cookieOf = (feed: string, hash: string) => createHmac("sha256", secret()).update(feed + hash).digest("hex");

export async function cookieValue(feed: string): Promise<string | null> {
  const hash = await readHash(feed);
  return hash === null ? null : cookieOf(feed, hash);
}

// The only comparison of an unlock cookie.
function cookieUnlocks(feed: string, hash: string, cookie: string | undefined): boolean {
  const want = Buffer.from(cookieOf(feed, hash));
  const got = Buffer.from(cookie ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

// No password at all is refused first: no scrypt, and nothing counted, or anyone could lock the owner out
// just by asking. Only a wrong password is a failed attempt; over the limit it is not even compared.
// The attempt is counted before the hashing and given back if the password was right: counted afterwards,
// every guess of a concurrent burst would get past the limit while the first ones are still hashing.
async function checkPassword(password: string | undefined, hash: string, ip: string): Promise<void> {
  if (!password) throw new AuthError();
  const attempt = authAttempt(ip);
  if (typeof attempt === "number") throw new TooManyAttemptsError(attempt);
  if (await verifyHash(password, hash)) return attempt();
  throw new AuthError();
}

// Passes for a feed without a password. True when the feed has one and this access proved it; a bad or
// stale cookie with no password beside it is, like no password, not a failed attempt.
export async function checkFeedAccess(feed: string, access: FeedAccess, ip: string): Promise<boolean> {
  const hash = await readHash(feed);
  if (hash === null) return false;
  if (!cookieUnlocks(feed, hash, access.cookie)) await checkPassword(access.password, hash, ip);
  return true;
}

/** For the pages. open: the feed has no password; unlocked: the cookie is the valid one; locked: anything else. Counts no attempts. */
export async function feedUnlocked(feed: string, cookie: string | undefined): Promise<"open" | "unlocked" | "locked"> {
  if (checkFeed(feed)) return "open"; // the page 404s on its own
  const hash = await readHash(feed);
  if (hash === null) return "open";
  return cookieUnlocks(feed, hash, cookie) ? "unlocked" : "locked";
}

export async function unlock(feed: string, password: string, ip: string): Promise<string> {
  const hash = await readHash(feed);
  if (hash === null) throw new AuthError();
  await checkPassword(password, hash, ip);
  return cookieOf(feed, hash);
}

export async function createProtected(feed: string, password: string): Promise<void> {
  checkNewPassword(password);
  if (await createProtectedFeed(feed, await hashPassword(password))) return;
  throw (await protectedFeed(feed)) ? new AuthError() : new FeedExistsError();
}

async function currentHash(feed: string, current: string, ip: string): Promise<string> {
  const hash = await readHash(feed);
  if (hash === null) throw new FeedExistsError();
  await checkPassword(current, hash, ip);
  return hash;
}

// Returns the unlock cookie for the new password; every earlier cookie stops working.
export async function changePassword(feed: string, current: string, next: string, ip: string): Promise<string> {
  checkNewPassword(next);
  await currentHash(feed, current, ip);
  const hash = await hashPassword(next);
  // ponytail: checked, not locked. The write is by path after the scrypt wait, so a feed deleted and
  // re-created meanwhile (same name) gets this password; a per-feed lock would close it.
  try {
    await writeHash(feed, hash);
  } catch (e) {
    if (isErrno(e, "ENOENT")) throw new NotFoundError("no such feed"); // deleted meanwhile
    throw e;
  }
  return cookieOf(feed, hash);
}

export async function removePassword(feed: string, current: string, ip: string): Promise<void> {
  await currentHash(feed, current, ip);
  await removeHash(feed);
}
