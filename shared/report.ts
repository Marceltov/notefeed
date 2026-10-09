// The report link of a note (issue #154): NOTEFEED_REPORT_URL is a URL template, and each placeholder is swapped for the
// value, percent-encoded so that it is safe in a query string, a path or a mailto: subject alike. The read id, never the feed
// name: the link is on the read-only view too, and the name is the write key (ADR 0001). Runs on the server and in the browser.
export const REPORT_PLACEHOLDERS = ["read_id", "note_id", "file"] as const;

export function reportUrl(template: string, values: { readId: string; noteId: string; file: string }): string {
  const by: Record<(typeof REPORT_PLACEHOLDERS)[number], string> = { read_id: values.readId, note_id: values.noteId, file: values.file };
  return template.replace(/\{(read_id|note_id|file)\}/g, (_, k: keyof typeof by) => encodeURIComponent(by[k]));
}
