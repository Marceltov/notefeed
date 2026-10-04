import { fromMarkdown } from "mdast-util-from-markdown";

// An image link with no scheme and no leading slash names a file of the feed (`![](<file>)`), and is
// shown from the feed's current read link, so it follows a changed read id. Anything else stays as written.
export const isRelativeLink = (src: string): boolean => src !== "" && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(src);

// For the RSS feed, whose readers have no base to resolve against: relative image links in the markdown
// become absolute. Output only; the stored note is not changed.
export const absolutizeImages = (markdown: string, base: string): string =>
  markdown.replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (m, head: string, src: string) => (isRelativeLink(src) ? head + base + src : m));

/** How many pictures one note may be sent with. */
export const MAX_ATTACHMENTS = 10;

/**
 * What no file name holds: control characters (C0, U+007F, C1: U+009B opens a terminal escape), the text-direction overrides, embeddings
 * and isolates (U+202A to U+202E, U+2066 to U+2069: they let a name read as another), `/` and `\`. The one definition: not global, so `test` keeps no state.
 */
export const FORBIDDEN_IN_NAME = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069/\\]/;

/** A name as it may be shown in a message: each forbidden character as U+FFFD, at most 200 characters. */
export const safeName = (name: string): string => name.replace(new RegExp(FORBIDDEN_IN_NAME, "g"), "\ufffd").slice(0, 200);

/** A name an attachment may have: one path segment of 1 to 200 characters, none of FORBIDDEN_IN_NAME, no leading/trailing space, not only dots. */
export const isAttachmentName = (name: string): boolean => name.length >= 1 && name.length <= 200 && !FORBIDDEN_IN_NAME.test(name) && name === name.trim() && !/^\.+$/.test(name);

type MdNode = { type: string; children?: MdNode[]; position?: { start: { offset?: number }; end: { offset?: number } } };

const collect = (node: MdNode, out: MdNode[] = []): MdNode[] => {
  if (node.type === "image" || node.type === "definition") out.push(node);
  for (const child of node.children ?? []) collect(child, out);
  return out;
};

// The source range of the destination of an `image` or `definition` node, or null (a reference-style image has none).
function destinationRange(src: string, node: MdNode): [number, number] | null {
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
function resolve(dest: string, sent: ReadonlyMap<string, string>): string | undefined {
  if (sent.has(dest)) return dest;
  try {
    const decoded = decodeURIComponent(dest);
    return sent.has(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Swaps the destination of each image and each link definition that refers to a key of `sent` (name → file name),
 * by parsing the markdown; every other byte stays. Each entry the text never referred to is appended as `![](file)`,
 * one paragraph each, after the trimmed text.
 */
export function placeImages(markdown: string, sent: ReadonlyMap<string, string>): string {
  if (sent.size === 0) return markdown;
  // The parser drops a leading BOM, so its offsets would be one short: set it aside.
  if (markdown.startsWith("\uFEFF")) return "\uFEFF" + placeImages(markdown.slice(1), sent);
  const used = new Set<string>();
  let text = "";
  let at = 0;
  for (const node of collect(fromMarkdown(markdown) as MdNode)) {
    const range = destinationRange(markdown, node);
    if (!range) continue;
    const key = resolve(markdown.slice(range[0], range[1]).replace(/^<(.*)>$/s, "$1"), sent);
    if (key === undefined) continue;
    used.add(key);
    text += markdown.slice(at, range[0]) + sent.get(key);
    at = range[1];
  }
  text += markdown.slice(at);
  const rest = [...sent].filter(([name]) => !used.has(name)).map(([, file]) => `![](${file})`);
  return rest.length === 0 ? text : [text.trimEnd(), ...rest].filter((p) => p !== "").join("\n\n");
}
