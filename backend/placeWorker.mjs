// Runs in a worker thread (backend/place.ts): parses one markdown text and answers with where its pictures are. Plain JavaScript,
// loaded as it is. A failure (a text so deeply nested the parser overflows its stack) is answered, not thrown.
import { parentPort, workerData } from "node:worker_threads";
import { planImages } from "../shared/imagePlan.mjs";

try {
  const { edits, unused } = planImages(workerData.markdown, new Set(workerData.names));
  parentPort.postMessage({ edits, unused });
} catch (e) {
  parentPort.postMessage({ failed: e instanceof Error ? e.message : String(e) });
}
