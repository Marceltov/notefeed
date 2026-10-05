// The operator's endpoint for the image store (issue #127), /api/operator/images/unreferenced:
//   GET     what is in the store that no note names (count and bytes), without touching it
//   DELETE  the same, and those objects are removed
// Off (404) unless NOTEFEED_OPERATOR_TOKEN is set (32 bytes or more); then it needs `Authorization: Bearer <token>`. It is under /api,
// which proxy.ts leaves to its handlers, and it is not in the public API description: it is the operator's, as /metrics is.
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { authFailed, authWait, clientIp } from "../limits";
import { logger } from "../log";
import { imagesSwept } from "../metrics";
import { storage } from "../storage";
import type { SqlStorage } from "../storage/sql";

// An object younger than this is never counted or removed: its note's row may still be on its way (the object is written first).
export const MIN_AGE_MS = 3_600_000;

const log = logger("operator");
// Both sides hashed first, so the comparison takes the same time and works for tokens of any length.
const digest = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected));
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function unreferencedImagesRoute(req: Request): Promise<Response> {
  const token = config.operatorToken();
  if (!token) return json({ error: "not found" }, 404);
  const ip = clientIp(req.headers);
  const wait = authWait(ip);
  if (wait !== null) return json({ error: "too many failed attempts" }, 429, { "Retry-After": String(wait) });
  const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!given || !sameToken(given, token)) {
    authFailed(ip);
    return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }
  const remove = req.method === "DELETE";
  const s = storage() as Partial<SqlStorage>;
  let sweep;
  try {
    sweep = (await s.sweepImages?.({ remove, olderThanMs: MIN_AGE_MS })) ?? null;
  } catch (err) {
    log.error({ err }, "the image store could not be checked for unreferenced images");
    return json({ error: "the image store could not be read; see the log" }, 502);
  }
  if (!sweep) return json({ error: "this instance has no image store: NOTEFEED_IMAGES is db, or NOTEFEED_STORAGE is fs" }, 409);
  const left = { count: sweep.unreferenced.count - sweep.deleted.count, bytes: sweep.unreferenced.bytes - sweep.deleted.bytes };
  imagesSwept({ ...left, missing: sweep.missing });
  return json({
    store: config.images(),
    unreferenced: sweep.unreferenced,
    ...(remove && { deleted: sweep.deleted, failed: sweep.failed }),
    too_recent: sweep.tooRecent,
    missing: sweep.missing,
  });
}
