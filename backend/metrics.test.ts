import { afterEach, expect, test, vi } from "vitest";
import { renderMetrics, resetMetricsForTest } from "./metrics";

afterEach(() => resetMetricsForTest());

const names = (body: string) => new Set([...body.matchAll(/^# TYPE (\S+)/gm)].map((m) => m[1]));

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
