// Metrics in the Prometheus text format (GET /metrics, see backend/http/metrics.ts). The only importer of prom-client. The
// counters live in this process's memory and start again at 0 on a restart; Prometheus keeps the history. Labels are fixed
// values only: never a feed name, read id, text, sender or address.
import { collectDefaultMetrics, Registry } from "prom-client";
import { processState } from "./state";

// One registry for all route bundles (see processState).
function registry(): Registry {
  return processState("metrics", () => {
    const register = new Registry();
    collectDefaultMetrics({ register, prefix: "notefeed_" });
    return register;
  }) as Registry;
}

export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  const r = registry();
  return { contentType: r.contentType, body: await r.metrics() };
}

/** Tests only: drops the registry (and stops its default collectors), so the next use starts empty. */
export function resetMetricsForTest(): void {
  const g = globalThis as Record<symbol, unknown>;
  const key = Symbol.for("notefeed.metrics");
  (g[key] as Registry | undefined)?.clear();
  delete g[key];
}
