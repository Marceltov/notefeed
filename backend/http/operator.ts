// The operator's endpoints. Off (404) unless NOTEFEED_OPERATOR_TOKEN is set (32 bytes or more); then each needs
// `Authorization: Bearer <token>`. They are under /api, which proxy.ts leaves to its handlers, and not in the public API description:
// they are the operator's, as /metrics is.
//   /api/operator/images/unreferenced (issue #127)
//     GET     what is in the store that no note names (count and bytes), without touching it
//     DELETE  the same, and those objects are removed
//   /api/operator/takedown (issue #155)
//     POST    removes the feed a read link, a read id or an image URL names, for good, and blocklists its images
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { authFailed, authWait, clientIp } from "../limits";
import { logger } from "../log";
import { imagesSwept } from "../metrics";
import { storage } from "../storage";
import { NotefeedError } from "../errors";
import { statusOf } from "./errors";
import type { SqlStorage } from "../storage/sql";
import { takedown } from "../takedown";

// An object younger than this is never counted or removed: its note's row may still be on its way (the object is written first).
export const MIN_AGE_MS = 3_600_000;

const log = logger("operator");
// Both sides hashed first, so the comparison takes the same time and works for tokens of any length.
const digest = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected));
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

// The gate of every operator endpoint: 404 while there is no token, 429 after too many wrong ones, 401 for a wrong or missing one.
function gate(req: Request): Response | null {
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
  return null;
}

export async function unreferencedImagesRoute(req: Request): Promise<Response> {
  const refused = gate(req);
  if (refused) return refused;
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

// The body names the feed: `{"target": "<read link | read id | image URL>"}`. The answer says what went and never the feed's name;
// `image_keys` are the image store objects removed, for the operator's purge of backups.
export async function takedownRoute(req: Request): Promise<Response> {
  const refused = gate(req);
  if (refused) return refused;
  const body = (await req.json().catch(() => undefined)) as { target?: unknown } | undefined;
  if (typeof body?.target !== "string" || !body.target.trim()) return json({ error: 'the body is JSON with "target": a read link, a read id or an image URL' }, 400);
  try {
    return json(await takedown(body.target));
  } catch (e) {
    if (e instanceof NotefeedError) return json({ error: e.message, code: e.code }, statusOf(e));
    log.error({ err: e }, "the takedown failed");
    return json({ error: "the takedown failed; see the log" }, 500);
  }
}
