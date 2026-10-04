// Pictures dropped, pasted or picked in a note box wait in the browser until the note is posted. While they wait, the text refers to
// each by a local name (the token); the note is posted with them in one request, and the server swaps each token for the stored file's name.
import { FORBIDDEN_IN_TEXT, MAX_ALT, MAX_ATTACHMENTS } from "@/shared/links";

/** A picture waiting to be posted; `token` is the name the text refers to it by, `preview` an object URL of the file to show it by. */
export type Pending = { key: string; file: File; token: string; preview: string };

/** What of `files` still fits in a box that holds `pending` (a note takes MAX_ATTACHMENTS pictures), and whether some were left out. */
export function fitPending<T>(pending: readonly unknown[], files: readonly T[]): { fit: T[]; leftOut: boolean } {
  const fit = files.slice(0, Math.max(0, MAX_ATTACHMENTS - pending.length));
  return { fit, leftOut: fit.length < files.length };
}

let counter = 0;
/** In an event handler only (it makes the object URL); release it with `URL.revokeObjectURL(preview)` when the picture is taken out. */
export const newPending = (file: File, token: string): Pending => ({ key: `${Date.now()}-${counter++}`, file, token, preview: URL.createObjectURL(file) });

/** A name for a file that is safe to write in `![](…)` and not among `taken`: `a.png`, then `a-2.png`, `a-3.png`. Never empty or only dots. */
export function uniqueToken(name: string, taken: ReadonlySet<string>): string {
  const safe = name.replace(/^.*[\\/]/, "").replace(/[^A-Za-z0-9._-]+/g, "-");
  const base = /^\.*$/.test(safe) ? "image" : safe;
  const dot = base.lastIndexOf(".");
  const [whole, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot, dot + 20)] : [base, ""];
  // The server takes names of at most 200 characters; the token is only a local name it swaps, so shortening it is invisible.
  const stem = whole.slice(0, 190 - ext.length);
  for (let n = 1; ; n++) {
    const token = n === 1 ? stem + ext : `${stem}-${n}${ext}`;
    if (!taken.has(token)) return token;
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the text holds nothing but pictures from `tokens`: posting it makes their notes and no text note. */
export const onlyReferences = (text: string, tokens: readonly string[]): boolean => tokens.reduce(removeReference, text).trim() === "";

/** Takes the images that refer to `token` out of the text: a line holding only the image goes whole, an image in a line goes alone. */
export function removeReference(text: string, token: string): string {
  const ref = `!\\[[^\\]]*\\]\\(${escapeRe(token)}\\)`;
  return text.replace(new RegExp(`^${ref}[ \\t]*(\\n|$)`, "gm"), "").replace(new RegExp(ref, "g"), "");
}

/**
 * The alt text each of `tokens` is given in the text, for a box that holds nothing but pictures (the text is not sent then, so its alt
 * texts would be lost): the first non-empty one among the picture's references. Cleaned as the server wants an alt text, one line of at
 * most MAX_ALT characters with no forbidden character, so a pasted line separator cannot make the whole post fail. A picture with none is left out.
 */
export function altsOf(text: string, tokens: readonly string[]): Record<string, string> {
  const alts: Record<string, string> = {};
  for (const token of tokens) {
    for (const [, raw] of text.matchAll(new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRe(token)}\\)`, "g"))) {
      const alt = Array.from(raw.replace(new RegExp(FORBIDDEN_IN_TEXT, "g"), " ").replace(/\s+/g, " ").trim()).slice(0, MAX_ALT).join("").trim();
      if (alt) {
        alts[token] = alt;
        break;
      }
    }
  }
  return alts;
}
