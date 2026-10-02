// The verified sender of a note lives in a leading `---` block of its `.md`: `sender: <JSON string>`.
// Read and written only by data/notes.ts. Note.markdown stays the typed body.
const BLOCK = /^---\n((?:[^\n]*\n)*?)---\n/;

export function encode(markdown: string, sender?: string): string {
  if (sender !== undefined) return `---\nsender: ${JSON.stringify(sender)}\n---\n${markdown}`;
  // An empty block ahead of a body that starts with `---`, so decode never takes the typed text for ours.
  return markdown.startsWith("---\n") ? `---\n---\n${markdown}` : markdown;
}

// Only the first block counts, and only if every line is `sender: <JSON string>` (or it is empty);
// anything else, any other key or value, is a legacy note and all body.
// ponytail: a legacy note that is exactly such a sender-only block, or starts `---\n---\n`, reads as having one.
export function decode(raw: string): { markdown: string; sender?: string } {
  const m = BLOCK.exec(raw);
  if (!m) return { markdown: raw };
  let sender: string | undefined;
  for (const line of m[1].split("\n").slice(0, -1)) {
    const kv = /^sender: ([^]*)$/.exec(line);
    let v: unknown;
    try {
      v = kv && JSON.parse(kv[1]);
    } catch {
      return { markdown: raw };
    }
    if (typeof v !== "string") return { markdown: raw };
    sender = v;
  }
  const markdown = raw.slice(m[0].length);
  return sender === undefined ? { markdown } : { markdown, sender };
}
