// Pure helpers shared by the backend (note titles and ids) and the compose box preview. No Node APIs:
// this runs in the browser too.

const lines = (markdown: string) => markdown.replace(/^﻿/, "").split(/\r?\n/);

// Index of the first `# ` heading outside ``` / ~~~ fences (a `# comment` in a shell snippet is not a title), or -1.
function headingIndex(ls: string[]): number {
  let fence = false;
  for (let i = 0; i < ls.length; i++) {
    if (/^\s*(```|~~~)/.test(ls[i])) fence = !fence;
    else if (!fence && /^#\s+/.test(ls[i])) return i;
  }
  return -1;
}

export function extractTitle(markdown: string): string {
  const ls = lines(markdown);
  const h = headingIndex(ls);
  const heading = h === -1 ? undefined : ls[h];
  const line = heading ?? ls.find((l) => l.trim() !== "") ?? "";
  return line
    .replace(/^\s*(?:(?:#{1,6}|[>*+-]|\d+\.)\s*)+/, "")
    .replace(/[*_`]/g, "")
    .trim()
    .slice(0, 100);
}

/** UTC timestamp to the second: 20260929T140512Z */
export function idStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/** The note without the line its title came from, so lists don't repeat the title. */
export function bodyAfterTitle(markdown: string): string {
  const ls = lines(markdown);
  const first = ls.findIndex((l) => l.trim() !== "");
  if (first === -1) return "";
  const h = headingIndex(ls);
  const titleIsFirst = h === first || h === -1;
  return titleIsFirst ? ls.slice(first + 1).join("\n").trim() : markdown.trim();
}
