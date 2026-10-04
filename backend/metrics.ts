// Metrics in the Prometheus text format (GET /metrics, see backend/http/metrics.ts). The only importer of prom-client. The
// counters live in this process's memory and start again at 0 on a restart; Prometheus keeps the history. Labels are fixed
// values only: never a feed name, read id, text, sender or address.
import { AsyncLocalStorage } from "node:async_hooks";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";
import { config } from "./config";
import { processState } from "./state";

const SECONDS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const COUNTS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];

type Metrics = {
  register: Registry;
  duration: Histogram<"kind" | "status" | "feed_size">; dirs: Histogram<"kind" | "feed_size">; files: Histogram<"kind" | "feed_size">;
  parse: Histogram;
  timeouts: Counter;
  waiting: Gauge;
};

// One set for all route bundles (see processState), created on first use: with metrics off it never exists.
function metrics(): Metrics {
  return processState("metrics", () => {
    const register = new Registry();
    collectDefaultMetrics({ register, prefix: "notefeed_" });
    return {
      register,
      duration: new Histogram({ name: "notefeed_request_duration_seconds", help: "Request duration by route kind, status class and the size of the feed it ran against", labelNames: ["kind", "status", "feed_size"], buckets: SECONDS, registers: [register] }),
      dirs: new Histogram({ name: "notefeed_request_dir_reads", help: "Directory reads per request", labelNames: ["kind", "feed_size"], buckets: COUNTS, registers: [register] }),
      files: new Histogram({ name: "notefeed_request_file_reads", help: "File reads per request", labelNames: ["kind", "feed_size"], buckets: COUNTS, registers: [register] }),
      parse: new Histogram({ name: "notefeed_parse_duration_seconds", help: "How long reading a text in the picture-reading worker took", buckets: SECONDS, registers: [register] }),
      timeouts: new Counter({ name: "notefeed_parse_timeouts_total", help: "Texts refused because reading them took longer than NOTEFEED_PARSE_TIMEOUT_MS", registers: [register] }),
      waiting: new Gauge({ name: "notefeed_parse_waiting", help: "Texts waiting for a picture-reading worker", registers: [register] }),
    };
  });
}

export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  const { register } = metrics();
  return { contentType: register.contentType, body: await register.metrics() };
}

/** Tests only: every sample back to its start. The registry stays: its default collectors cannot be stopped, so a new one would leak them. */
export function resetMetricsForTest(): void {
  const m = metrics();
  for (const metric of [m.duration, m.dirs, m.files, m.parse, m.timeouts, m.waiting]) metric.reset();
}

export type FeedSize = "none" | "lt10" | "lt100" | "lt1000" | "gte1000";

/** The size class of a feed by its number of notes; `none` for a request that never read a feed. */
export function sizeBucket(notes: number | null): FeedSize {
  if (notes === null) return "none";
  return notes < 10 ? "lt10" : notes < 100 ? "lt100" : notes < 1000 ? "lt1000" : "gte1000";
}

/** A redirect counts as a success here (a posted form answers 303). */
export function statusClass(status: number): "2xx" | "4xx" | "5xx" {
  return status >= 500 ? "5xx" : status >= 400 ? "4xx" : "2xx";
}

type Scope = { dirs: number; files: number; size: number | null };
const scope = () => processState("metrics-scope", () => new AsyncLocalStorage<Scope>());

/**
 * Runs `fn` as one measured request: its duration, and the directory and file reads and the feed size that the data layer
 * reports meanwhile, are recorded under `kind` (a fixed name, never user input). A throw counts as 5xx and goes on.
 */
export async function measured<T>(kind: string, fn: () => Promise<T>, statusOf: (result: T) => number): Promise<T> {
  if (!config.metrics()) return fn();
  const own: Scope = { dirs: 0, files: 0, size: null };
  const start = performance.now();
  let status = 500;
  try {
    const result = await scope().run(own, fn);
    status = statusOf(result);
    return result;
  } finally {
    const m = metrics();
    const feed_size = sizeBucket(own.size);
    m.duration.observe({ kind, status: statusClass(status), feed_size }, (performance.now() - start) / 1000);
    m.dirs.observe({ kind, feed_size }, own.dirs);
    m.files.observe({ kind, feed_size }, own.files);
  }
}

/** One directory read of the current request; nothing outside a measured request. */
export const countDir = (): void => void (scope().getStore() && scope().getStore()!.dirs++);
/** One file read of the current request. */
export const countFile = (): void => void (scope().getStore() && scope().getStore()!.files++);
/** The number of notes of the feed the current request is reading. */
export function noteFeedSize(notes: number): void {
  const s = scope().getStore();
  if (s) s.size = notes;
}

// The picture-reading worker (backend/place.ts); each does nothing with metrics off.
/** One text read in a worker took this long (a refused one too). */
export const observeParse = (seconds: number): void => void (config.metrics() && metrics().parse.observe(seconds));
/** One text was refused for time. */
export const parseTimedOut = (): void => void (config.metrics() && metrics().timeouts.inc());
/** The number of texts waiting for a worker now. */
export const setParseWaiting = (n: number): void => void (config.metrics() && metrics().waiting.set(n));
