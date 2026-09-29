// RSS 2.0, written by hand. Descriptions carry the raw markdown in CDATA.
import type { Note } from "./notes";

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

// "]]>" would end the section early; split it across two CDATA sections.
const cdata = (s: string) => `<![CDATA[${s.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

export function renderFeed(notes: Note[], opts: { title: string; baseUrl: string }): string {
  const items = notes.map((n) => {
    const url = `${opts.baseUrl}/n/${n.id}`;
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
<link>${opts.baseUrl}</link>
<description>${escapeXml(opts.title)}</description>
${items.join("\n")}
</channel>
</rss>
`;
}
