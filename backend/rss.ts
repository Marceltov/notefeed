// RSS 2.0, written by hand. Descriptions carry the raw markdown in CDATA.
import type { Note } from "./notes";
import { readPath } from "./urls";

// XML 1.0 forbids most C0 controls (e.g. ANSI color codes from scripts); one would break the whole feed.
// Stripped on output only — the .md file keeps the original bytes.
const xmlSafe = (s: string) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "");

const escapeXml = (s: string) =>
  xmlSafe(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

// "]]>" would end the section early; split it across two CDATA sections.
const cdata = (s: string) => `<![CDATA[${xmlSafe(s).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

// Links go through the read id only, so the feed never reveals the (writable) feed name.
export function renderFeed(notes: Note[], opts: { title: string; description: string; baseUrl: string; readId: string; imageUrl?: string }): string {
  const base = opts.baseUrl + readPath(opts.readId);
  const items = notes.map((n) => {
    const url = `${base}/${n.id}`;
    return `<item>
<title>${escapeXml(n.title || n.id)}</title>
<link>${url}</link>
<guid isPermaLink="true">${url}</guid>
<pubDate>${n.createdAt.toUTCString()}</pubDate>
<description>${cdata(n.markdown)}</description>
</item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${escapeXml(opts.title)}</title>
<link>${base}</link>
<description>${escapeXml(opts.description)}</description>
${opts.imageUrl ? `<image><url>${escapeXml(opts.imageUrl)}</url><title>${escapeXml(opts.title)}</title><link>${base}</link></image>\n` : ""}${items.join("\n")}
</channel>
</rss>
`;
}
