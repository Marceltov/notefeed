// The image store named by NOTEFEED_IMAGES, for the database backends. null for `db`: the bytes stay in the note's row.
import { config } from "../../config";
import { createFsImageStore } from "./fs";
import { createS3ImageStore } from "./s3";
import type { ImageStore } from "./types";

export function createImageStore(): ImageStore | null {
  const kind = config.images();
  if (kind === "fs") return createFsImageStore(config.imagesDir());
  if (kind === "s3") return createS3ImageStore(config.s3());
  return null;
}
