// Finding the pictures of a note's markdown by parsing it. Plain JavaScript (types in JSDoc) because the backend runs `planImages` in a
// worker thread (backend/place.ts, backend/placeWorker.mjs), which loads this file as it is. The parser's cost is not bounded by the
// input's size, so it never runs on the main thread of the server.
import { fromMarkdown } from "mdast-util-from-markdown";

/** @typedef {{ type: string, identifier?: string, children?: MdNode[], position?: { start: { offset?: number }, end: { offset?: number } } }} MdNode */
/** Where the destinations of the images and link definitions that name a picture are (see `applyImages`). @typedef {{ markdown: string, edits: { from: number, to: number, name: string }[], unused: string[] }} ImagePlan */

/** @param {MdNode} node @param {MdNode[]} [out] @returns {MdNode[]} */
const collect = (node, out = []) => {
  if (node.type === "image" || node.type === "definition") out.push(node);
  for (const child of node.children ?? []) collect(child, out);
  return out;
};

// The source range of the destination of an `image` or `definition` node, or null (a reference-style image has none).
/** @param {string} src @param {MdNode} node @returns {[number, number] | null} */
function destinationRange(src, node) {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  let i = start + (node.type === "image" ? 2 : 1);
  // the label: up to its closing bracket, brackets nested, backslash escapes skipped
  for (let depth = 0; i < end; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === "[") depth++;
    else if (src[i] === "]" && depth-- === 0) break;
  }
  i++;
  if (src[i] !== (node.type === "image" ? "(" : ":")) return null;
  while (/\s/.test(src[++i] ?? "x"));
  if (i >= end) return null;
  const from = i;
  const angle = src[i] === "<";
  let depth = 0;
  for (i += angle ? 1 : 0; i < end; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (angle) {
      if (c === ">") return [from, i + 1];
    } else if (/\s/.test(c) || (c === ")" && depth === 0)) break;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
  }
  return [from, i];
}

// The key of `sent` a destination, as written, refers to: exact, else percent-decoded.
/** @param {string} dest @param {{ has(key: string): boolean }} sent @returns {string | undefined} */
function resolve(dest, sent) {
  if (sent.has(dest)) return dest;
  try {
    const decoded = decodeURIComponent(dest);
    return sent.has(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finds the destination of each image and each link definition that refers to one of `names`, by parsing the markdown; a repeated
 * label's later definition is ignored, as markdown ignores it.
 * @param {string} markdown @param {ReadonlySet<string>} names @returns {ImagePlan}
 */
export function planImages(markdown, names) {
  /** @type {ImagePlan["edits"]} */
  const edits = [];
  const used = new Set();
  if (names.size > 0) {
    // The parser drops a leading BOM, so its offsets would be one short: set it aside.
    const bom = markdown.startsWith("﻿") ? 1 : 0;
    const src = markdown.slice(bom);
    const labels = new Set();
    for (const node of collect(/** @type {MdNode} */ (fromMarkdown(src)))) {
      // Markdown uses the first definition of a label (`identifier` is the label normalized) and ignores a later one: so does this.
      if (node.type === "definition") {
        if (labels.has(node.identifier ?? "")) continue;
        labels.add(node.identifier ?? "");
      }
      const range = destinationRange(src, node);
      if (!range) continue;
      const name = resolve(src.slice(range[0], range[1]).replace(/^<(.*)>$/s, "$1"), names);
      if (name === undefined) continue;
      used.add(name);
      edits.push({ from: range[0] + bom, to: range[1] + bom, name });
    }
  }
  return { markdown, edits, unused: [...names].filter((name) => !used.has(name)) };
}

/**
 * The plan's markdown with each destination swapped for the file name `sent` (name → file name) gives its picture; every other byte
 * stays. Each picture the text never referred to is appended as `![](file)`, one paragraph each, after the trimmed text.
 * @param {ImagePlan} plan @param {ReadonlyMap<string, string>} sent @returns {string}
 */
export function applyImages(plan, sent) {
  const { markdown } = plan;
  let text = "";
  let at = 0;
  for (const { from, to, name } of plan.edits) {
    text += markdown.slice(at, from) + sent.get(name);
    at = to;
  }
  text += markdown.slice(at);
  const rest = plan.unused.map((name) => `![](${sent.get(name)})`);
  return rest.length === 0 ? text : [text.trimEnd(), ...rest].filter((p) => p !== "").join("\n\n");
}

/** `applyImages(planImages(...))` in one step, on this thread: for tests and small inputs only. @param {string} markdown @param {ReadonlyMap<string, string>} sent */
export const placeImages = (markdown, sent) => applyImages(planImages(markdown, new Set(sent.keys())), sent);
