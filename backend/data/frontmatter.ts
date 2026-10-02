// Every note file starts with a block of `key: <JSON value>` lines between `---` lines (empty when there is no
// metadata); everything after it is the body. Read and written only by data/notes.ts. Note.markdown is the body.
const KEY = /^[a-z][a-z0-9_]*$/;

export type Meta = Record<string, unknown>;

export function encode(markdown: string, meta: Meta = {}): string {
  const lines = Object.keys(meta)
    .sort()
    .map((k) => `${k}: ${JSON.stringify(meta[k])}\n`);
  return `---\n${lines.join("")}---\n${markdown}`;
}

// Only the first block counts, and only if every line before its closing `---` is `key: <valid JSON>`;
// anything else (no block, CRLF, any other line, no closing line) is a legacy note and all body.
// ponytail: a legacy note whose first lines are `---`, only `key: <JSON>` lines (or none), then `---` reads as having
// a block, so that header is hidden from the displayed body (the file is untouched); one starting `---\n---\n`
// loses that pair from the displayed body.
export function decode(raw: string): { markdown: string; meta: Meta; sender?: string } {
  const legacy = { markdown: raw, meta: {} };
  if (!raw.startsWith("---\n")) return legacy;
  const lines = raw.split("\n");
  const end = lines.indexOf("---", 1);
  if (end < 0) return legacy;
  const meta: Meta = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([^:]*): ([^]*)$/.exec(line);
    if (!m || !KEY.test(m[1])) return legacy;
    try {
      meta[m[1]] = JSON.parse(m[2]);
    } catch {
      return legacy;
    }
  }
  const markdown = lines.slice(end + 1).join("\n");
  return typeof meta.sender === "string" ? { markdown, meta, sender: meta.sender } : { markdown, meta };
}
