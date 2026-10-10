// The operator's endpoints for the image store. Off (404) unless NOTEFEED_OPERATOR_TOKEN is set (32 bytes or more); then each needs
// `Authorization: Bearer <token>`. They are under /api, which proxy.ts leaves to its handlers, and not in the public API description:
// they are the operator's, as /metrics is.
//   /api/operator/images/unreferenced (issue #127)
//     GET     what is in the store that no note names (count and bytes), without touching it
//     DELETE  the same, and those objects are removed
//   /api/operator/images/move (issue #128)
//     POST    moves image bytes into the configured store, from the rows or from another store named in the JSON body
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../config";
import { authFailed, authWait, clientIp } from "../limits";
import { logger } from "../log";
import { imagesSwept } from "../metrics";
import { storage } from "../storage";
import { createFsImageStore } from "../storage/images/fs";
import { createS3ImageStore } from "../storage/images/s3";
import type { ImageStore } from "../storage/images/types";
import type { SqlStorage } from "../storage/sql";

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

// What the move takes from: the rows (`db`), a folder, or an S3-compatible store with its settings. The source's secrets travel in the
// body of this one request and are never logged or answered back.
const MoveBody = z.discriminatedUnion("from", [
  z.object({ from: z.literal("db") }),
  z.object({ from: z.literal("fs"), dir: z.string().min(1) }),
  z.object({ from: z.literal("s3"), endpoint: z.string().url(), bucket: z.string().min(1), region: z.string().min(1).default("us-east-1"), access_key: z.string().min(1), secret_key: z.string().min(1) }),
]).and(z.object({ limit: z.number().int().min(1).max(10_000).default(100), after: z.string().min(1).optional() }));

export async function moveImagesRoute(req: Request): Promise<Response> {
  const refused = gate(req);
  if (refused) return refused;
  const parsed = MoveBody.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return json({ error: 'the body is JSON with "from": "db", "fs" (with "dir") or "s3" (with "endpoint", "bucket", "access_key", "secret_key", optional "region"), and an optional "limit"' }, 400);
  const body = parsed.data;
  const from: ImageStore | "db" = body.from === "db" ? "db" : body.from === "fs" ? createFsImageStore(body.dir) : createS3ImageStore({ endpoint: body.endpoint, bucket: body.bucket, region: body.region, accessKey: body.access_key, secretKey: body.secret_key });
  const s = storage() as Partial<SqlStorage>;
  if (!s.moveImages) return json({ error: "this instance has no database: NOTEFEED_STORAGE is fs, and an image is the note's own file" }, 409);
  let move;
  try {
    move = await s.moveImages({ from, limit: body.limit, after: body.after });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/nothing to move/.test(message)) return json({ error: message }, 409);
    log.error({ err }, "images could not be moved");
    return json({ error: "the images could not be moved; see the log" }, 502);
  }
  return json({ store: config.images(), from: body.from, moved: move.moved, skipped: move.skipped, missing: move.missing, failed: move.failed, left: move.left, next: move.next });
}
