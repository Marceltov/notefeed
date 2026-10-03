// An image link with no scheme and no leading slash names a file of the feed (`![](<file>)`), and is
// shown from the feed's current read link, so it follows a changed read id. Anything else stays as written.
export const isRelativeLink = (src: string): boolean => src !== "" && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(src);

// For the RSS feed, whose readers have no base to resolve against: relative image links in the markdown
// become absolute. Output only; the stored note is not changed.
export const absolutizeImages = (markdown: string, base: string): string =>
  markdown.replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (m, head: string, src: string) => (isRelativeLink(src) ? head + base + src : m));

const IMAGE_REF = /(!\[[^\]]*\]\()([^)\s]+)(\))/g;

/** Names an attachment may have: safe to write in `![](…)`. */
export const ATTACHMENT_NAME = /^[A-Za-z0-9._-]+$/;

// Swaps the destination of each image whose destination is exactly a key of `sent`; `used` collects the keys it swapped.
const swap = (text: string, sent: ReadonlyMap<string, string>, used?: Set<string>): string =>
  sent.size === 0
    ? text
    : text.replace(IMAGE_REF, (m, head: string, dest: string, tail: string) => {
        if (!sent.has(dest)) return m;
        used?.add(dest);
        return head + sent.get(dest) + tail;
      });

/** Swaps the destination of each image whose destination is exactly a key of `sent` (name → file name). Nothing else changes. */
export const substitute = (text: string, sent: ReadonlyMap<string, string>): string => swap(text, sent);

/** `substitute`, then each entry of `sent` the text never referred to is appended as `![](file)`, one paragraph each. */
export function placeImages(markdown: string, sent: ReadonlyMap<string, string>): string {
  const used = new Set<string>();
  const text = swap(markdown, sent, used);
  const rest = [...sent].filter(([name]) => !used.has(name)).map(([, file]) => `![](${file})`);
  return rest.length === 0 ? text : [text.trimEnd(), ...rest].filter((p) => p !== "").join("\n\n");
}
