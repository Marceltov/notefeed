import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readIdOf, resetFeedsForTests } from "../feeds";
import { resetMetricsForTest } from "../metrics";
import { createNote } from "../notes";
import { dispatch } from "./api";
import { metricsRoute } from "./metrics";
import { rssRoute } from "./rss";

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-metrics-"));
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("NOTEFEED_METRICS", "1");
  vi.stubEnv("NOTEFEED_METRICS_TOKEN", "");
  vi.stubEnv("NOTEFEED_PASSWORD", "");
  resetFeedsForTests();
});
afterEach(() => {
  resetMetricsForTest();
  vi.unstubAllEnvs();
});

const scrape = (authorization?: string) => metricsRoute(new Request("http://localhost:3000/metrics", { headers: authorization === undefined ? {} : { authorization } }));

test("off: 404, whatever the request carries", async () => {
  vi.stubEnv("NOTEFEED_METRICS", "0");
  vi.stubEnv("NOTEFEED_METRICS_TOKEN", "tok");
  expect((await scrape("Bearer tok")).status).toBe(404);
});

test("on without a token: open, in the Prometheus text format", async () => {
  const res = await scrape();
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/plain");
  expect(await res.text()).toContain("notefeed_process_cpu_user_seconds_total");
});

test.each([
  ["no header", undefined],
  ["a wrong token", "Bearer nope"],
  ["a token of another length", "Bearer t"],
  ["an empty token", "Bearer "],
  ["nothing after the scheme", "Bearer"],
  ["another scheme", "Basic s3cret"],
  ["the token without a scheme", "s3cret"],
])("with a token set, %s is 401 with a Bearer challenge", async (_, header) => {
  vi.stubEnv("NOTEFEED_METRICS_TOKEN", "s3cret");
  const res = await scrape(header);
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toBe("Bearer");
  expect(await res.text()).not.toContain("notefeed_");
});

test("with a token set, the right one is 200", async () => {
  vi.stubEnv("NOTEFEED_METRICS_TOKEN", "s3cret");
  expect((await scrape("Bearer s3cret")).status).toBe(200);
});

test("a scrape after requests against a named feed holds no feed name, read id or note text", async () => {
  await createNote("secretname", "# SECRETTEXT title\n\nSECRETTEXT body", new Date("2026-09-29T10:00:00Z"));
  const rid = (await readIdOf("secretname"))!;
  await dispatch(new Request("http://localhost:3000/api/v1/feeds/secretname/notes?tag=secrettag"), ["feeds", "secretname", "notes"]);
  await dispatch(new Request("http://localhost:3000/api/v1/feeds/secretname/notes"), ["feeds", "secretname", "notes"]);
  await rssRoute(new Request(`http://localhost:3000/r/${rid}/feed.xml`), rid);
  const body = await (await scrape()).text();
  expect(body).toMatch(/notefeed_request_duration_seconds_count\{kind="listNotes_tag"/); // the requests were measured at all
  for (const secret of ["secretname", "secrettag", rid, "SECRETTEXT"]) expect(body).not.toContain(secret);
});
