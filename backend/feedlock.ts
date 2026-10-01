// Optional per-feed password: DATA_DIR/<feed>/.password holds a scrypt hash, set only when the feed is created.
// Unprotected feeds (no file) pass every check. The file is read per request, so deleting it unlocks at once.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createFeedDirWithHash, readHash, removeHash, writeHash } from "./data/password";
import { AuthError, FeedExistsError, InvalidBodyError, TooManyAttemptsError } from "./errors";
import { addFeed, secret } from "./feeds";
import { authFailed, authWait } from "./limits";

export type FeedAccess = { password?: string; cookie?: string };

export const feedCookieName = (feed: string) => `nf_feed_${feed}`;

export function checkNewPassword(p: string): void {
  if (p.length < 1 || p.length > 256) throw new InvalidBodyError("password must be 1 to 256 characters");
}

const N = 16384, R = 8, P = 1, KEYLEN = 64;
const derive = (p: string, salt: Buffer, n: number, r: number, pp: number, len: number) =>
  scryptSync(p, salt, len, { N: n, r, p: pp, maxmem: 128 * n * r * 2 });

// scrypt$N$r$p$salt$hash (base64), so the parameters can change later without breaking stored hashes.
export function hashPassword(p: string): string {
  const salt = randomBytes(16);
  return ["scrypt", N, R, P, salt.toString("base64"), derive(p, salt, N, R, P, KEYLEN).toString("base64")].join("$");
}

export function verifyHash(p: string, hash: string): boolean {
  const [tag, n, r, pp, salt, key] = hash.split("$");
  if (tag !== "scrypt" || !key) return false;
  try {
    const want = Buffer.from(key, "base64");
    const got = derive(p, Buffer.from(salt, "base64"), +n, +r, +pp, want.length);
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

// Over the failed-attempt limit the password is not even compared; only wrong passwords are counted.
function checkPassword(password: string, hash: string, ip: string): void {
  const wait = authWait(ip);
  if (wait !== null) throw new TooManyAttemptsError(wait);
  if (verifyHash(password, hash)) return;
  authFailed(ip);
  throw new AuthError();
}

function checkAccessTo(feed: string, hash: string, access: FeedAccess, ip: string): void {
  if (access.cookie !== undefined) {
    const want = Buffer.from(cookieOf(feed, hash));
    const got = Buffer.from(access.cookie);
    if (got.length === want.length && timingSafeEqual(got, want)) return;
    // A bad or stale cookie alone is not a failed attempt: no scrypt, nothing counted.
    if (!access.password) throw new AuthError();
  }
  checkPassword(access.password ?? "", hash, ip);
}

export async function checkFeedAccess(feed: string, access: FeedAccess, ip: string): Promise<void> {
  const hash = await readHash(feed);
  if (hash !== null) checkAccessTo(feed, hash, access, ip);
}

export async function unlock(feed: string, password: string, ip: string): Promise<string> {
  const hash = await readHash(feed);
  if (hash === null) throw new AuthError();
  checkPassword(password, hash, ip);
  return cookieOf(feed, hash);
}

export async function createProtected(feed: string, password: string): Promise<void> {
  checkNewPassword(password);
  if (await createFeedDirWithHash(feed, hashPassword(password))) return void (await addFeed(feed));
  throw (await protectedFeed(feed)) ? new AuthError() : new FeedExistsError();
}

async function currentHash(feed: string, current: string, ip: string): Promise<string> {
  const hash = await readHash(feed);
  if (hash === null) throw new FeedExistsError();
  checkPassword(current, hash, ip);
  return hash;
}

export async function changePassword(feed: string, current: string, next: string, ip: string): Promise<void> {
  checkNewPassword(next);
  await currentHash(feed, current, ip);
  await writeHash(feed, hashPassword(next));
}

export async function removePassword(feed: string, current: string, ip: string): Promise<void> {
  await currentHash(feed, current, ip);
  await removeHash(feed);
}
