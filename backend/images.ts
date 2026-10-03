// Images: format by the file's first bytes, the content-addressed name, the per-feed cap. Storage is data/images.ts.
import { createHash } from "node:crypto";
import { config } from "./config";
import { countImages, hasImage, readImageFile, writeImage } from "./data/images";
import { isErrno } from "./data/fs";
import { ImageLimitError, NotFoundError, UnsupportedTypeError } from "./errors";
import { capReached } from "./limits";

export const IMAGE_FILE_RE = /^[0-9a-f]{32}\.(png|jpg|gif|webp)$/;
export type ImageType = "png" | "jpg" | "gif" | "webp";

const CONTENT_TYPES: Record<ImageType, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

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

export const imageName = (b: Uint8Array, type: ImageType): string => `${createHash("sha256").update(b).digest("hex").slice(0, 32)}.${type}`;

// Sniff, name, cap (a repeat of an existing image is never refused), write. The feed must exist (posting.ts
// checks); one deleted meanwhile is "no such feed", and its directory is not made again.
export async function storeImage(feed: string, bytes: Uint8Array): Promise<string> {
  const type = sniffImage(bytes);
  if (!type) throw new UnsupportedTypeError("send a PNG, JPEG, GIF or WebP image");
  const name = imageName(bytes, type);
  const max = config.maxImagesPerFeed();
  // ponytail: checked, not locked; concurrent uploads can overshoot the cap by a few.
  if (max && !(await hasImage(feed, name)) && (await countImages(feed, (n) => IMAGE_FILE_RE.test(n))) >= max) throw capReached("image", new ImageLimitError());
  try {
    await writeImage(feed, name, bytes);
  } catch (e) {
    if (isErrno(e, "ENOENT")) throw new NotFoundError("no such feed");
    throw e;
  }
  return name;
}

// True only for a well-formed name of an image this feed has: the one check before a name becomes a path.
export const knownImage = async (feed: string, name: string): Promise<boolean> => IMAGE_FILE_RE.test(name) && (await hasImage(feed, name));

export async function loadImage(feed: string, file: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!IMAGE_FILE_RE.test(file)) return null;
  const bytes = await readImageFile(feed, file);
  return bytes && { bytes, contentType: CONTENT_TYPES[file.split(".")[1] as ImageType] };
}
