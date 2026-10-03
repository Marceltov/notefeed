// Images: the format by the file's first bytes, and the type an extension is served as. Image notes are stored like any note (backend/note/image.ts).
export type ImageType = "png" | "jpg" | "gif" | "webp";

const CONTENT_TYPES: Record<ImageType, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
export const IMAGE_EXTS = Object.keys(CONTENT_TYPES) as ImageType[];

const starts = (b: Uint8Array, at: number, sig: number[] | string) =>
  (typeof sig === "string" ? [...sig].map((c) => c.charCodeAt(0)) : sig).every((v, i) => b[at + i] === v);

// SVG and anything else is null. Only the header is looked at: the file is served with nosniff and a sandbox CSP.
export function sniffImage(b: Uint8Array): ImageType | null {
  if (starts(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(b, 0, [0xff, 0xd8, 0xff])) return "jpg";
  if (starts(b, 0, "GIF87a") || starts(b, 0, "GIF89a")) return "gif";
  if (starts(b, 0, "RIFF") && starts(b, 8, "WEBP")) return "webp";
  return null;
}

// What a file of a feed is served as, by its extension; a type we don't know is a download.
export const contentTypeOf = (ext: string): string =>
  CONTENT_TYPES[ext as ImageType] ?? (ext === "md" ? "text/plain; charset=utf-8" : "application/octet-stream");
