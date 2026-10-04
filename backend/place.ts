// Finding the pictures of a note's markdown means parsing it, and the parser's cost is not bounded by the input's size (a text under 100 KB
// can take it minutes). So the parse runs in a worker thread, one per text, with a time limit: a text that is too slow costs the one who
// sent it that time, and the server's main thread (everyone else's requests) goes on.
import { Worker } from "node:worker_threads";
import type { ImagePlan } from "../shared/imagePlan.mjs";
import { config } from "./config";
import { InvalidBodyError } from "./errors";
import { observeParse, parseTimedOut, setParseWaiting } from "./metrics";

const MAX_WORKERS = 4; // at once; more wait their turn (their time limit starts when theirs does)
const MEMORY_MB = 512; // a worker's heap; past it the text is refused, not the server killed

let running = 0;
const waiting: (() => void)[] = [];
async function turn(): Promise<void> {
  if (running < MAX_WORKERS) return void running++;
  await new Promise<void>((resolve) => {
    waiting.push(resolve); // the finished one hands over its place
    setParseWaiting(waiting.length);
  });
}
function release(): void {
  const next = waiting.shift();
  setParseWaiting(waiting.length);
  if (next) next();
  else running--;
}

// What can be found without parsing: a text with no `![` and no `]:` has no image and no link definition.
const mayHavePictures = (markdown: string) => markdown.includes("![") || markdown.includes("]:");

/** `planImages` of the text, run in a worker. Refused (InvalidBodyError) when it takes longer than NOTEFEED_PARSE_TIMEOUT_MS or the parser fails. */
export async function planInWorker(markdown: string, names: ReadonlySet<string>): Promise<ImagePlan> {
  if (names.size === 0 || !mayHavePictures(markdown)) return { markdown, edits: [], unused: [...names] };
  await turn();
  const started = performance.now();
  try {
    return await run(markdown, names);
  } finally {
    observeParse((performance.now() - started) / 1000);
    release();
  }
}

function run(markdown: string, names: ReadonlySet<string>): Promise<ImagePlan> {
  const limit = config.parseTimeoutMs();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./placeWorker.mjs", import.meta.url), { workerData: { markdown, names: [...names] }, resourceLimits: { maxOldGenerationSizeMb: MEMORY_MB } });
    const refuse = (why: string) => {
      parseTimedOut();
      void worker.terminate();
      reject(new InvalidBodyError(`the text cannot be sent with pictures: ${why}`));
    };
    const timer = setTimeout(() => refuse(`reading it took longer than ${limit / 1000} seconds; shorten or simplify it, or post it without pictures`), limit);
    worker.once("message", (m: { edits: ImagePlan["edits"]; unused: string[] } | { failed: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if ("failed" in m) reject(new InvalidBodyError("the text cannot be sent with pictures: it is too deeply nested to read"));
      else resolve({ markdown, edits: m.edits, unused: m.unused });
    });
    worker.once("error", (e) => {
      clearTimeout(timer);
      reject(new InvalidBodyError(`the text cannot be sent with pictures: it could not be read (${(e as NodeJS.ErrnoException).code ?? "failed"})`));
    });
  });
}
