import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderMetrics, resetMetricsForTest } from "./metrics";
import { planInWorker } from "./place";

afterEach(() => vi.unstubAllEnvs());

const names = new Set(["a.png", "b.png"]);

test("the plan is that of planImages: where the references are, and which pictures nothing refers to", async () => {
  const plan = await planInWorker("﻿# Hi ![x](a.png)\n\n[l]: <b.png>", names);
  expect(plan.unused).toEqual([]);
  expect(plan.edits.map((e) => [plan.markdown.slice(e.from, e.to), e.name])).toEqual([["a.png", "a.png"], ["<b.png>", "b.png"]]);
  expect((await planInWorker("![x](a.png)", names)).unused).toEqual(["b.png"]);
});

test("a text with nothing that can be a picture is not read at all", async () => {
  expect(await planInWorker("# Just words", names)).toEqual({ markdown: "# Just words", edits: [], unused: ["a.png", "b.png"] });
  expect(await planInWorker("![x](a.png)", new Set())).toEqual({ markdown: "![x](a.png)", edits: [], unused: [] });
});

test("a text that takes too long is refused after the limit, and the main thread keeps running meanwhile", async () => {
  vi.stubEnv("NOTEFEED_PARSE_TIMEOUT_MS", "1000");
  let last = performance.now();
  let worst = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
  }, 10);
  const started = performance.now();
  await expect(planInWorker(">".repeat(80000) + " ![](a.png)", names)).rejects.toThrow(/took longer than 1 seconds/);
  clearInterval(tick);
  expect(performance.now() - started).toBeLessThan(3000);
  expect(worst).toBeLessThan(200); // parsed on this thread it would have been one gap of seconds
});

test("more texts than workers all get their turn", async () => {
  const plans = await Promise.all(Array.from({ length: 12 }, (_, i) => planInWorker(`![x](a.png) ${i}`, names)));
  expect(plans.map((p) => p.markdown.slice(-2).trim())).toEqual(Array.from({ length: 12 }, (_, i) => String(i)));
});

// The value of an unlabelled metric line, e.g. `notefeed_parse_waiting 8`.
async function value(metric: string): Promise<number | undefined> {
  const line = (await renderMetrics()).body.split("\n").find((l) => l.startsWith(`${metric} `));
  return line === undefined ? undefined : Number(line.slice(metric.length + 1));
}

describe("metrics", () => {
  beforeEach(() => vi.stubEnv("NOTEFEED_METRICS", "1"));
  afterEach(() => resetMetricsForTest());

  test("a text read in the worker adds one sample to the parse duration; one read without a worker adds none", async () => {
    await planInWorker("![x](a.png)", names);
    await planInWorker("# Just words", names);
    expect(await value("notefeed_parse_duration_seconds_count")).toBe(1);
  });

  test("a text refused for time counts as a timeout, a text read in time does not", async () => {
    await planInWorker("![x](a.png)", names);
    expect(await value("notefeed_parse_timeouts_total")).toBe(0);
    vi.stubEnv("NOTEFEED_PARSE_TIMEOUT_MS", "300");
    await expect(planInWorker(">".repeat(80000) + " ![](a.png)", names)).rejects.toThrow(/took longer than/);
    expect(await value("notefeed_parse_timeouts_total")).toBe(1);
    expect(await value("notefeed_parse_duration_seconds_count")).toBe(2); // a refused text took time too
  });

  test("the texts waiting for a worker are counted, and none are left when all are done", async () => {
    const all = Promise.all(Array.from({ length: 12 }, (_, i) => planInWorker(`![x](a.png) ${i}`, names)));
    expect(await value("notefeed_parse_waiting")).toBe(8); // four workers at once
    await all;
    expect(await value("notefeed_parse_waiting")).toBe(0);
  });
});
