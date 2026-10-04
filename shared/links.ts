// An image link with no scheme and no leading slash names a file of the feed (`![](<file>)`), and is
// shown from the feed's current read link, so it follows a changed read id. Anything else stays as written.
export const isRelativeLink = (src: string): boolean => src !== "" && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(src);

// For the RSS feed, whose readers have no base to resolve against: relative image links in the markdown
// become absolute. Output only; the stored note is not changed.
export const absolutizeImages = (markdown: string, base: string): string =>
  markdown.replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (m, head: string, src: string) => (isRelativeLink(src) ? head + base + src : m));

/** How many pictures one note may be sent with. */
export const MAX_ATTACHMENTS = 10;

/** The longest alt text, in characters (an emoji is one). */
export const MAX_ALT = 500;

// What no line of text (a title, an alt text, a name) holds: control characters (C0, U+007F, C1: U+009B opens a terminal escape), the line
// and paragraph separators (U+2028, U+2029), and the text-direction overrides, embeddings and isolates (U+202A to U+202E, U+2066 to U+2069:
// they let a text read as another). The marks U+200E, U+200F and U+061C and the joiners stay: right-to-left text and emoji need them.
const TEXT_SET = String.raw`\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069`;

/** What no title or alt text holds. Not global, so `test` keeps no state. */
export const FORBIDDEN_IN_TEXT = new RegExp(`[${TEXT_SET}]`);

/** What no file name holds: the same, and `/` and `\`. The one definition of the name rule's characters. */
export const FORBIDDEN_IN_NAME = new RegExp(String.raw`[${TEXT_SET}/\\]`);

/** A name as it may be shown in a message: each forbidden character as U+FFFD, at most 200 characters. */
export const safeName = (name: string): string => name.replace(new RegExp(FORBIDDEN_IN_NAME, "g"), "\ufffd").slice(0, 200);

/** A file's original name as kept and shown: none of FORBIDDEN_IN_NAME, trimmed, at most 200 characters. */
export const cleanName = (name: string | undefined): string | undefined => (name ?? "").replace(new RegExp(FORBIDDEN_IN_NAME, "g"), "").trim().slice(0, 200) || undefined;

/** A name an attachment may have: one path segment of 1 to 200 characters, none of FORBIDDEN_IN_NAME, no leading/trailing space, not only dots. */
export const isAttachmentName = (name: string): boolean => name.length >= 1 && name.length <= 200 && !FORBIDDEN_IN_NAME.test(name) && name === name.trim() && !/^\.+$/.test(name);
