// Pictures dropped, pasted or picked in a note box wait in the browser until the note is posted. While they wait, the text refers to
// each by a local name (the token); posting uploads them as notes and swaps each token for the new note's file name.

/** A picture waiting to be posted; `token` is the name the text refers to it by, `preview` an object URL of the file to show it by. */
export type Pending = { key: string; file: File; token: string; preview: string };

let counter = 0;
/** In an event handler only (it makes the object URL); release it with `URL.revokeObjectURL(preview)` when the picture is taken out. */
export const newPending = (file: File, token: string): Pending => ({ key: `${Date.now()}-${counter++}`, file, token, preview: URL.createObjectURL(file) });

/** A name for a file that is safe to write in `![](…)` and not among `taken`: `a.png`, then `a-2.png`, `a-3.png`. */
export function uniqueToken(name: string, taken: ReadonlySet<string>): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/[^A-Za-z0-9._-]+/g, "-") || "image";
  const dot = base.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ""];
  for (let n = 1; ; n++) {
    const token = n === 1 ? base : `${stem}-${n}${ext}`;
    if (!taken.has(token)) return token;
  }
}

const IMAGE_REF = /(!\[[^\]]*\]\()([^)\s]+)(\))/g;

/** Swaps the destination of each image whose destination is exactly a key of `sent` (token → file name). Nothing else changes. */
export const substitute = (text: string, sent: ReadonlyMap<string, string>): string =>
  sent.size === 0 ? text : text.replace(IMAGE_REF, (m, head: string, dest: string, tail: string) => (sent.has(dest) ? head + sent.get(dest) + tail : m));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the text holds nothing but pictures from `tokens`: posting it makes their notes and no text note. */
export const onlyReferences = (text: string, tokens: readonly string[]): boolean => tokens.reduce(removeReference, text).trim() === "";

/** Takes the images that refer to `token` out of the text: a line holding only the image goes whole, an image in a line goes alone. */
export function removeReference(text: string, token: string): string {
  const ref = `!\\[[^\\]]*\\]\\(${escapeRe(token)}\\)`;
  return text.replace(new RegExp(`^${ref}[ \\t]*(\\n|$)`, "gm"), "").replace(new RegExp(ref, "g"), "");
}
