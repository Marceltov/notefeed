// Pure helpers shared by the server (lib/notes.ts) and the compose box preview.

export function extractTitle(markdown: string): string {
  const lines = markdown.replace(/^﻿/, "").split(/\r?\n/);
  const heading = lines.find((l) => /^#\s+/.test(l));
  const line = heading ?? lines.find((l) => l.trim() !== "") ?? "";
  return line
    .replace(/^\s*(?:(?:#{1,6}|[>*+-]|\d+\.)\s*)+/, "")
    .replace(/[*_`]/g, "")
    .trim()
    .slice(0, 100);
}

export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return slug || "note";
}

/** UTC timestamp to the second: 20260929T140512Z */
export function idStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/** The note without the line its title came from, so lists don't repeat the title. */
export function bodyAfterTitle(markdown: string): string {
  const lines = markdown.replace(/^﻿/, "").split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first === -1) return "";
  const titleIsFirst = /^#\s+/.test(lines[first]) || !lines.some((l) => /^#\s+/.test(l));
  return titleIsFirst ? lines.slice(first + 1).join("\n").trim() : markdown.trim();
}
