import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFeedFile, writeNote } from "./data/notes";
import { listNotes } from "./notes";
import { countDir, countFile, measured, noteFeedSize, renderMetrics, resetMetricsForTest, sizeBucket, statusClass } from "./metrics";

beforeEach(() => {
  process.env.NOTEFEED_METRICS = "1";
});
afterEach(() => {
  resetMetricsForTest();
  delete process.env.NOTEFEED_METRICS;
});

const names = (body: string) => new Set([...body.matchAll(/^# TYPE (\S+)/gm)].map((m) => m[1]));

// The value of the sample `metric` whose labels include all of `labels`; undefined when there is none.
async function sample(metric: string, labels: Record<string, string>): Promise<number | undefined> {
  const { body } = await renderMetrics();
  const line = body.split("\n").find((l) => l.startsWith(`${metric}{`) && Object.entries(labels).every(([k, v]) => l.includes(`${k}="${v}"`)));
  return line === undefined ? undefined : Number(line.slice(line.lastIndexOf(" ") + 1));
}

test("renders default process metrics with the notefeed_ prefix", async () => {
  const { body, contentType } = await renderMetrics();
  expect(contentType).toContain("text/plain");
  expect(body).toContain("notefeed_process_cpu_user_seconds_total");
  expect(body).toMatch(/notefeed_nodejs_eventloop_lag_seconds/);
});

test("two imports share one registry", async () => {
  const first = await renderMetrics();
  vi.resetModules();
  const again = await import("./metrics");
  const second = await again.renderMetrics();
  expect(names(second.body)).toEqual(names(first.body));
});

test("sizeBucket: none for no feed, lt10 for an empty one, and the three boundaries", () => {
  expect([null, 0, 9, 10, 99, 100, 999, 1000].map(sizeBucket)).toEqual(["none", "lt10", "lt10", "lt100", "lt100", "lt1000", "lt1000", "gte1000"]);
});

test("statusClass: a redirect counts as 2xx", () => {
  expect([200, 303, 404, 500].map(statusClass)).toEqual(["2xx", "2xx", "4xx", "5xx"]);
});

test("measured records one duration sample with kind, status class and feed size", async () => {
  const reply = await measured("getFeed", async () => (noteFeedSize(5), { status: 404 }), (r) => r.status);
  expect(reply).toEqual({ status: 404 });
  expect(await sample("notefeed_request_duration_seconds_count", { kind: "getFeed", status: "4xx", feed_size: "lt10" })).toBe(1);
});

test("measured records the disk work of the request, per kind and feed size", async () => {
  await measured("listNotes", async () => {
    countDir();
    countDir();
    countFile();
    countFile();
    countFile();
    noteFeedSize(150);
    return 200;
  }, (s) => s);
  expect(await sample("notefeed_request_dir_reads_sum", { kind: "listNotes", feed_size: "lt1000" })).toBe(2);
  expect(await sample("notefeed_request_file_reads_sum", { kind: "listNotes", feed_size: "lt1000" })).toBe(3);
});

test("the counters do nothing outside a scope", async () => {
  countDir();
  countFile();
  noteFeedSize(5);
  const { body } = await renderMetrics();
  expect(body).not.toContain("notefeed_request_dir_reads_sum{");
  expect(body).not.toContain("notefeed_request_file_reads_sum{");
});

test("a request that never reads a feed is recorded with feed_size none", async () => {
  await measured("getOpenApi", async () => 200, (s) => s);
  expect(await sample("notefeed_request_duration_seconds_count", { kind: "getOpenApi", feed_size: "none" })).toBe(1);
});

test("a throwing request is recorded as 5xx and the error goes on", async () => {
  await expect(measured("postNote", async () => Promise.reject(new Error("boom")), () => 200)).rejects.toThrow("boom");
  expect(await sample("notefeed_request_duration_seconds_count", { kind: "postNote", status: "5xx" })).toBe(1);
});

test("with metrics off, measured returns the result and records nothing", async () => {
  process.env.NOTEFEED_METRICS = "0";
  expect(await measured("getFeed", async () => 7, () => 200)).toBe(7);
  const { body } = await renderMetrics();
  expect(body).not.toContain("notefeed_request_duration_seconds_count{");
});

test("reading a feed's notes reports its size and its directory and file reads to the request", async () => {
  const root = await mkdtemp(join(tmpdir(), "notefeed-"));
  process.env.DATA_DIR = root;
  await mkdir(join(root, "f"));
  for (const t of ["a", "b", "c"]) await writeNote("f", t, "md", t, {});
  await measured("listNotes", () => listNotes("f", 50), () => 200);
  expect(await sample("notefeed_request_duration_seconds_count", { kind: "listNotes", feed_size: "lt10" })).toBe(1);
  // The listing, then at least one more for each note read (readNote looks its file up by listing the folder): the cost #96 is about.
  expect(await sample("notefeed_request_dir_reads_sum", { kind: "listNotes" })).toBeGreaterThanOrEqual(4);
  expect(await sample("notefeed_request_file_reads_sum", { kind: "listNotes" })).toBeGreaterThanOrEqual(3);
});

test("a file of a feed read by name counts as one file read", async () => {
  const root = await mkdtemp(join(tmpdir(), "notefeed-"));
  process.env.DATA_DIR = root;
  await mkdir(join(root, "f"));
  await writeFile(join(root, "f", "x.txt"), "hi");
  await measured("feed_file", () => readFeedFile("f", "x.txt"), () => 200);
  expect(await sample("notefeed_request_file_reads_sum", { kind: "feed_file" })).toBe(1);
});
