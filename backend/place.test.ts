import { afterEach, expect, test, vi } from "vitest";
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
