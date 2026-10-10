import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { logsOf } from "../log";
import { renderMetrics, resetMetricsForTest } from "../metrics";
import { resetStorageForTests, storage } from "../storage";
import type { SqlStorage } from "../storage/sql";
import { moveImagesRoute, unreferencedImagesRoute } from "./operator";

const TOKEN = "operator-token-".padEnd(40, "x");
const node22 = Number(process.versions.node.split(".")[0]) >= 22; // better-sqlite3 and kysely need it
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "notefeed-operator-"));
  vi.stubEnv("DATA_DIR", root);
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", TOKEN);
  vi.stubEnv("NOTEFEED_STORAGE", "sqlite");
  vi.stubEnv("NOTEFEED_IMAGES", "fs");
  vi.stubEnv("NOTEFEED_METRICS", "1");
  vi.stubEnv("NOTEFEED_RATE_LIMIT", "60");
  resetFeedsForTests();
  resetRateLimitsForTests();
});
afterEach(async () => {
  await (storage() as Partial<SqlStorage>).close?.();
  resetStorageForTests();
  resetMetricsForTest();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

// `authorization` null: the header is not sent.
const call = (method: "GET" | "DELETE", authorization: string | null = `Bearer ${TOKEN}`) =>
  unreferencedImagesRoute(new Request("http://localhost:3000/api/operator/images/unreferenced", { method, headers: authorization === null ? {} : { authorization } }));

// A file in the image folder that no note names, written `hours` ago.
async function orphan(bytes: string, hours: number): Promise<string> {
  const key = randomBytes(16).toString("hex");
  const dir = join(root, "images", key.slice(0, 2));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, key), bytes);
  const at = new Date(Date.now() - hours * 3_600_000);
  await utimes(join(dir, key), at, at);
  return key;
}
const files = async () => (await readdir(join(root, "images"), { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);

test("without NOTEFEED_OPERATOR_TOKEN the endpoint is not there, whatever the request carries", async () => {
  vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", "");
  expect((await call("GET")).status).toBe(404);
  expect((await call("DELETE", "Bearer ")).status).toBe(404);
});

test("a token shorter than 32 bytes does not open it", async () => {
  vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", "short-token");
  expect((await call("DELETE", "Bearer short-token")).status).toBe(404);
});

test("no bearer, a wrong one, or another scheme: 401, and nothing is read or removed", async () => {
  if (!node22) return;
  const key = await orphan("left behind", 2);
  for (const authorization of [null, "Bearer wrong", `Basic ${TOKEN}`, `Bearer ${TOKEN}x`]) {
    const res = await call("DELETE", authorization);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  }
  expect(await files()).toEqual([key]);
});

test("failed attempts are limited like failed passwords", async () => {
  vi.stubEnv("NOTEFEED_RATE_LIMIT", "3");
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await call("GET", "Bearer wrong")).status);
  expect(statuses).toContain(429);
  expect((await call("GET")).status).toBe(429); // the right token waits too, once the address is over the limit
});

test.skipIf(!node22)("GET reports what no note names and removes nothing; DELETE removes exactly that", async () => {
  const s = storage();
  await s.createFeed("f", "rid-f");
  await s.writeNote("f", "p", "png", Buffer.from("a note's image"), {});
  const [kept] = await files();
  const old = new Date(Date.now() - 2 * 3_600_000);
  await utimes(join(root, "images", kept.slice(0, 2), kept), old, old);
  const gone = [await orphan("12345", 2), await orphan("123", 48)];
  const young = await orphan("being posted", 0);

  const report = await call("GET");
  expect(report.status).toBe(200);
  expect(report.headers.get("cache-control")).toBe("no-store");
  expect(await report.json()).toEqual({ store: "fs", unreferenced: { count: 2, bytes: 8 }, too_recent: 1, missing: 0 });
  expect((await files()).sort()).toEqual([kept, ...gone, young].sort());

  const cleaned = await call("DELETE");
  expect(cleaned.status).toBe(200);
  expect(await cleaned.json()).toEqual({ store: "fs", unreferenced: { count: 2, bytes: 8 }, deleted: { count: 2, bytes: 8 }, failed: 0, too_recent: 1, missing: 0 });
  expect((await files()).sort()).toEqual([kept, young].sort());
  expect((await s.readFile("f", "p.png"))?.toString()).toBe("a note's image");
});

test.skipIf(!node22)("the metrics say what the last run left, and are absent before the first", async () => {
  expect((await renderMetrics()).body).not.toContain("notefeed_images_");
  await orphan("12345", 2);
  await call("GET");
  let body = (await renderMetrics()).body;
  expect(body).toMatch(/^notefeed_images_unreferenced 1$/m);
  expect(body).toMatch(/^notefeed_images_unreferenced_bytes 5$/m);
  expect(body).toMatch(/^notefeed_images_missing 0$/m);
  expect(Number(/^notefeed_images_checked_timestamp_seconds (\d+)$/m.exec(body)?.[1])).toBeGreaterThan(Date.now() / 1000 - 60);
  await call("DELETE");
  body = (await renderMetrics()).body;
  expect(body).toMatch(/^notefeed_images_unreferenced 0$/m);
  expect(body).toMatch(/^notefeed_images_unreferenced_bytes 0$/m);
});

test.skipIf(!node22)("images in the database: 409, saying so", async () => {
  vi.stubEnv("NOTEFEED_IMAGES", "db");
  const res = await call("DELETE");
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/no image store/);
});

test("the file system backend: 409", async () => {
  vi.stubEnv("NOTEFEED_STORAGE", "fs");
  vi.stubEnv("NOTEFEED_IMAGES", "db");
  expect((await call("GET")).status).toBe(409);
});

test.skipIf(!node22)("an image folder that cannot be read: 502 and a log line, with nothing of the path in the answer", async () => {
  await writeFile(join(root, "images"), "a file where the folder should be");
  const logs = await logsOf(async () => {
    const res = await call("DELETE");
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain(root);
  });
  expect(logs.filter((l) => l.level === "error")).toHaveLength(1);
});

// POST /api/operator/images/move (#128): the same gate, a JSON body naming the source.
const move = (body: unknown, authorization: string | null = `Bearer ${TOKEN}`) =>
  moveImagesRoute(new Request("http://localhost:3000/api/operator/images/move", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...(authorization === null ? {} : { authorization }) } }));

test("move: the gate is the same (404 without a token, 401 with a wrong one)", async () => {
  expect((await move({ from: "db" }, "Bearer wrong")).status).toBe(401);
  vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", "");
  expect((await move({ from: "db" })).status).toBe(404);
});

test.skipIf(!node22)("move: a body that names no source is 400; the rows go into the folder; the folder itself as the source is 409", async () => {
  for (const body of ["not json", {}, { from: "nowhere" }, { from: "fs" }, { from: "s3", endpoint: "x" }, { from: "db", limit: 0 }]) expect((await move(body)).status, JSON.stringify(body)).toBe(400);
  // Images posted while NOTEFEED_IMAGES was db: their rows hold the bytes.
  vi.stubEnv("NOTEFEED_IMAGES", "db");
  resetStorageForTests();
  const plain = storage();
  await plain.createFeed("f", "rid-f");
  const id = await plain.writeNote("f", "p", "png", Buffer.from("picture bytes"), {});
  await (plain as Partial<SqlStorage>).close?.();
  vi.stubEnv("NOTEFEED_IMAGES", "fs");
  resetStorageForTests();
  const res = await move({ from: "db" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ store: "fs", from: "db", moved: { count: 1, bytes: 13 }, skipped: 0, missing: 0, failed: 0, left: 0, next: null });
  expect(await files()).toHaveLength(1);
  expect((await storage().readNote("f", id, ["png"], () => true))?.content.toString()).toBe("picture bytes");
  const same = await move({ from: "fs", dir: join(root, "images") });
  expect(same.status).toBe(409);
  expect(await files()).toHaveLength(1);
  const again = await move({ from: "db" }); // nothing left in the rows is not an error
  expect(again.status).toBe(200);
  expect(await again.json()).toMatchObject({ moved: { count: 0, bytes: 0 }, left: 0 });
});

test("move: on the file system backend there is no database, 409", async () => {
  vi.stubEnv("NOTEFEED_STORAGE", "fs");
  vi.stubEnv("NOTEFEED_IMAGES", "db");
  resetStorageForTests();
  expect((await move({ from: "db" })).status).toBe(409);
});
