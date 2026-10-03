// The media types a note can be posted as, and the extension each is stored under. A leaf module (no note classes), so Note can use it.
export const MEDIA_TYPES = [
  { mediaType: "text/markdown", ext: "md" },
  { mediaType: "image/png", ext: "png" },
  { mediaType: "image/jpeg", ext: "jpg" },
  { mediaType: "image/gif", ext: "gif" },
  { mediaType: "image/webp", ext: "webp" },
] as const;

/** For error messages: every media type a post may declare. */
export const ACCEPTED_TYPES = MEDIA_TYPES.map((m) => m.mediaType).join(", ");

/** The media type a stored extension is posted and listed as; `application/octet-stream` for one we don't know. */
export const mediaTypeOf = (ext: string): string => MEDIA_TYPES.find((m) => m.ext === ext)?.mediaType ?? "application/octet-stream";

const UTF8 = /^charset=("?)utf-8\1$/i;

/**
 * A `Content-Type` header as one of ours, or null: the type must match exactly (case aside) and the only parameter allowed is
 * `charset=utf-8`, on markdown. Nothing is guessed: `text/plain`, a form type, `application/octet-stream` and a missing header are null.
 */
export function parseMedia(header: string | null): { mediaType: string; ext: string } | null {
  if (!header) return null;
  const [head, ...params] = header.split(";").map((p) => p.trim());
  const entry = MEDIA_TYPES.find((m) => m.mediaType === head.toLowerCase());
  if (!entry) return null;
  if (params.length > 1 || (params.length === 1 && !(entry.mediaType === "text/markdown" && UTF8.test(params[0])))) return null;
  return entry;
}
