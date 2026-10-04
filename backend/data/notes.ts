// A note on disk is a content file `<DATA_DIR>/<feed>/<id>.<ext>`, stored exactly as posted, and an optional sidecar with
// its metadata, `.<id>.<ext>.json` (the content file's complete name plus `.json`). Dot files are never notes. Which
// extensions are notes is the caller's business (backend/note/types.ts); nothing here knows about types.
import { randomBytes } from "node:crypto";
import { link, lstat, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { countDir, countFile, noteFeedSize } from "../metrics";
import { feedDir, isErrno, orMissing } from "./fs";

export type { Meta } from "../storage/types";
import type { Meta } from "../storage/types";

const NAME_RE = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9]{1,16})$/;
const file = (feed: string, id: string, ext: string) => join(feedDir(feed), `${id}.${ext}`);
const sidecar = (feed: string, id: string, ext: string) => join(feedDir(feed), `.${id}.${ext}.json`);

const STRINGS = ["title", "sender", "alt", "name", "created"] as const;
// A sidecar may be hand-edited: only the known fields with the right type count; anything unreadable is no metadata.
function parseMeta(raw: string): Meta {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};
  const o = json as Record<string, unknown>;
  const meta: Meta = {};
  for (const k of STRINGS) if (typeof o[k] === "string") meta[k] = o[k];
  if (Array.isArray(o.tags)) {
    const tags = o.tags.filter((t): t is string => typeof t === "string");
    if (tags.length) meta.tags = tags;
  }
  return meta;
}

const hasMeta = (meta: Meta) => Object.values(meta).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0));

// Stores `content` as `<base>.<ext>`, or `<base>-2.<ext>`, `-3`, … if taken; returns the id used. The sidecar is written
// first, so a listed note always has its metadata; a failure removes it again. The feed directory must exist (ensureFeed
// creates it): a feed deleted meanwhile is ENOENT here, never a directory made again without its `.readid`.
// Never overwrites, never leaves a partial content file behind.
export async function writeNote(feed: string, base: string, ext: string, content: string | Uint8Array, meta: Meta): Promise<string> {
  const dir = feedDir(feed);
  const tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
  const json = hasMeta(meta) ? JSON.stringify(meta) : undefined;
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, content);
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      if (json !== undefined) {
        try {
          await writeFile(/*turbopackIgnore: true*/ sidecar(feed, id, ext), json, { flag: "wx" });
        } catch (e) {
          if (isErrno(e, "EEXIST")) continue; // a sidecar already claims this id
          throw e;
        }
      }
      try {
        // link() fails with EEXIST instead of overwriting, so the final name appears atomically and exclusively.
        await link(/*turbopackIgnore: true*/ tmp, file(feed, id, ext));
        return id;
      } catch (e) {
        if (json !== undefined) await unlink(/*turbopackIgnore: true*/ sidecar(feed, id, ext)).catch(() => {});
        if (!isErrno(e, "EEXIST")) throw e;
      }
    }
  } finally {
    await unlink(/*turbopackIgnore: true*/ tmp).catch(() => {});
  }
}

// Every file of the feed that could be a note: `<id>.<ext>`, no dot at the start, one dot. The caller filters by type.
export async function listNoteFiles(feed: string): Promise<{ id: string; ext: string }[]> {
  countDir();
  const names = await orMissing(readdir(/*turbopackIgnore: true*/ feedDir(feed)), []);
  const found = names.flatMap((f) => {
    const m = NAME_RE.exec(f);
    return m ? [{ id: m[1], ext: m[2] }] : [];
  });
  noteFeedSize(found.length);
  return found;
}

// `withContent` says for an extension whether the bytes are wanted: a picture is only listed, so reading it whole would cost its size
// for nothing; `content` is then empty and `size` (from the file system) is still right.
export async function readNote(feed: string, id: string, withContent: (ext: string) => boolean = () => true): Promise<{ ext: string; content: Buffer; size: number; meta: Meta; mtime: Date } | null> {
  const entry = (await listNoteFiles(feed)).find((e) => e.id === id);
  if (!entry) return null;
  const path = file(feed, id, entry.ext);
  const info = await orMissing(stat(/*turbopackIgnore: true*/ path), null);
  if (!info) return null;
  if (withContent(entry.ext)) countFile();
  const content = withContent(entry.ext) ? await orMissing(readFile(/*turbopackIgnore: true*/ path), null) : Buffer.alloc(0);
  if (content === null) return null;
  countFile();
  const raw = await orMissing(readFile(/*turbopackIgnore: true*/ sidecar(feed, id, entry.ext), "utf8"), "{}");
  return { ext: entry.ext, content, size: info.size, meta: parseMeta(raw), mtime: info.mtime };
}

// A file of the feed by its name (`<stem>.<ext>`, no dot at the start): the bytes of a regular file, null for anything else. A
// symbolic link is not followed, so nothing outside the feed folder is reachable.
export async function readFeedFile(feed: string, name: string): Promise<Buffer | null> {
  if (!NAME_RE.test(name)) return null;
  const path = join(feedDir(feed), name);
  const info = await orMissing(lstat(/*turbopackIgnore: true*/ path), null);
  if (!info?.isFile()) return null;
  countFile();
  return orMissing(readFile(/*turbopackIgnore: true*/ path), null);
}

// Replaces an existing note's content atomically (temp file, then rename over it); the sidecar is not touched. False, and
// nothing created, when there is no such note. ponytail: a delete landing between the lookup and the rename
// brings the note back with the edit; a per-feed lock would close it.
export async function replaceNote(feed: string, id: string, content: string | Uint8Array): Promise<boolean> {
  const entry = (await listNoteFiles(feed)).find((e) => e.id === id);
  if (!entry) return false;
  const tmp = join(feedDir(feed), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, content);
    await rename(/*turbopackIgnore: true*/ tmp, file(feed, id, entry.ext));
    return true;
  } catch (e) {
    if (isErrno(e, "ENOENT")) return false; // the feed was deleted since the lookup
    throw e;
  } finally {
    await unlink(/*turbopackIgnore: true*/ tmp).catch(() => {});
  }
}

// Changes some fields of an existing note's metadata: a string or list sets one, null (or an empty value) removes it. The sidecar is
// replaced atomically (temp file, then rename) and removed when nothing is left. False when there is no such note.
export async function updateMeta(feed: string, id: string, patch: { [K in keyof Meta]?: Meta[K] | null }): Promise<boolean> {
  const note = await readNote(feed, id, () => false);
  if (!note) return false;
  const merged: Record<string, unknown> = { ...note.meta };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete merged[k];
    else merged[k] = v;
  }
  const path = sidecar(feed, id, note.ext);
  if (!hasMeta(merged as Meta)) return orMissing(unlink(/*turbopackIgnore: true*/ path).then(() => true), true);
  const tmp = join(feedDir(feed), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(merged));
    await rename(/*turbopackIgnore: true*/ tmp, path);
    return true;
  } catch (e) {
    if (isErrno(e, "ENOENT")) return false; // the feed was deleted since the read
    throw e;
  } finally {
    await unlink(/*turbopackIgnore: true*/ tmp).catch(() => {});
  }
}

// Content first, then the sidecar: a sidecar left behind is ignored, content without its metadata would be shown bare.
export async function deleteNoteFile(feed: string, id: string): Promise<boolean> {
  const entry = (await listNoteFiles(feed)).find((e) => e.id === id);
  if (!entry) return false;
  const gone = await orMissing(unlink(/*turbopackIgnore: true*/ file(feed, id, entry.ext)).then(() => true), false);
  await orMissing(unlink(/*turbopackIgnore: true*/ sidecar(feed, id, entry.ext)), undefined);
  return gone;
}
