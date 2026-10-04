// A note on disk is a content file `<DATA_DIR>/<feed>/<id>.<ext>`, stored exactly as posted, and an optional sidecar with
// its metadata, `.<id>.<ext>.json` (the content file's complete name plus `.json`). Dot files are never notes. Which
// extensions are notes is the caller's business (backend/note/types.ts); nothing here knows about types.
// Only regular files count: a folder, a symbolic link or an unreadable entry in a feed folder is "not a note", never an error.
import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { link, lstat, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { countDir, countFile, noteFeedSize } from "../../metrics";
import { applyPatch, hasMeta, parseMeta } from "../meta";
import { FeedGoneError, type Meta, type NoteRef, type StoredNote } from "../types";
import { feedDir, isErrno } from "./fs";

const NAME_RE = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9]{1,16})$/;
const file = (feed: string, id: string, ext: string) => join(feedDir(feed), `${id}.${ext}`);
const sidecar = (feed: string, id: string, ext: string) => join(feedDir(feed), `.${id}.${ext}.json`);

// What a hand-placed oddity (a folder where a file should be, a link, a file we may not read) comes to: nothing there.
const GONE = ["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "ELOOP", "EPERM"];
const isGone = (e: unknown) => GONE.some((c) => isErrno(e, c));

async function regular(path: string): Promise<Stats | null> {
  try {
    const info = await lstat(/*turbopackIgnore: true*/ path);
    return info.isFile() ? info : null;
  } catch (e) {
    if (isGone(e)) return null;
    throw e;
  }
}

async function readRegular(path: string): Promise<Buffer | null> {
  if (!(await regular(path))) return null;
  countFile();
  try {
    return await readFile(/*turbopackIgnore: true*/ path);
  } catch (e) {
    if (isGone(e)) return null;
    throw e;
  }
}

async function metaOf(feed: string, id: string, ext: string): Promise<Meta> {
  const raw = await readRegular(sidecar(feed, id, ext));
  return raw ? parseMeta(raw.toString("utf8")) : {};
}

// The content file of a note, whichever of the accepted extensions it has: a few lstat calls, never a listing of the folder.
async function find(feed: string, id: string, exts: readonly string[]): Promise<{ ext: string; path: string; info: Stats } | null> {
  for (const ext of exts) {
    const path = file(feed, id, ext);
    const info = await regular(path);
    if (info) return { ext, path, info };
  }
  return null;
}

// Stores `content` as `<base>.<ext>`, or `<base>-2.<ext>`, `-3`, … if taken; returns the id used. The sidecar is written
// first, so a listed note always has its metadata; a failure removes it again. The feed directory must exist (ensureFeed
// creates it): a feed deleted meanwhile is FeedGoneError, never a directory made again without its `.readid`.
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
  } catch (e) {
    throw isErrno(e, "ENOENT") ? new FeedGoneError() : e;
  } finally {
    await unlink(/*turbopackIgnore: true*/ tmp).catch(() => {});
  }
}

// Every regular file of the feed that could be a note: `<id>.<ext>`, no dot at the start, one dot. The caller filters by type.
export async function listNoteRefs(feed: string): Promise<NoteRef[]> {
  countDir();
  let entries;
  try {
    entries = await readdir(/*turbopackIgnore: true*/ feedDir(feed), { withFileTypes: true });
  } catch (e) {
    if (isGone(e)) return [];
    throw e;
  }
  // Dirent.isFile() is false for a folder and for a symbolic link.
  const found = entries.flatMap((e) => {
    const m = e.isFile() ? NAME_RE.exec(e.name) : null;
    return m ? [{ id: m[1], ext: m[2] }] : [];
  });
  noteFeedSize(found.length);
  return found;
}

// `withContent` says for an extension whether the bytes are wanted: a picture is only listed, so reading it whole would cost its size
// for nothing; `content` is then empty and `size` (from the file system) is still right.
export async function readNote(feed: string, id: string, exts: readonly string[], withContent: (ext: string) => boolean): Promise<StoredNote | null> {
  const found = await find(feed, id, exts);
  if (!found) return null;
  const content = withContent(found.ext) ? await readRegular(found.path) : Buffer.alloc(0);
  if (content === null) return null;
  return { ext: found.ext, content, size: found.info.size, meta: await metaOf(feed, id, found.ext), mtime: found.info.mtime };
}

// Only the sidecar: what the tag filter needs. null when the note itself is not there.
export async function readMeta(feed: string, ref: NoteRef): Promise<Meta | null> {
  return (await regular(file(feed, ref.id, ref.ext))) ? metaOf(feed, ref.id, ref.ext) : null;
}

// A file of the feed by its name (`<stem>.<ext>`, no dot at the start): the bytes of a regular file, null for anything else. A
// symbolic link is not followed, so nothing outside the feed folder is reachable.
export async function readFeedFile(feed: string, name: string): Promise<Buffer | null> {
  return NAME_RE.test(name) ? readRegular(join(feedDir(feed), name)) : null;
}

// Replaces an existing note's content atomically (temp file, then rename over it); the sidecar is not touched. False, and
// nothing created, when there is no such note. ponytail: a delete landing between the lookup and the rename
// brings the note back with the edit; a per-feed lock would close it.
export async function replaceNote(feed: string, id: string, exts: readonly string[], content: string | Uint8Array): Promise<boolean> {
  const found = await find(feed, id, exts);
  if (!found) return false;
  const tmp = join(feedDir(feed), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(/*turbopackIgnore: true*/ tmp, content);
    await rename(/*turbopackIgnore: true*/ tmp, found.path);
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
export async function updateMeta(feed: string, id: string, exts: readonly string[], patch: { [K in keyof Meta]?: Meta[K] | null }): Promise<boolean> {
  const found = await find(feed, id, exts);
  if (!found) return false;
  const merged = applyPatch(await metaOf(feed, id, found.ext), patch);
  const path = sidecar(feed, id, found.ext);
  if (!hasMeta(merged)) {
    try {
      await unlink(/*turbopackIgnore: true*/ path);
    } catch (e) {
      if (!isErrno(e, "ENOENT")) throw e;
    }
    return true;
  }
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
export async function deleteNote(feed: string, id: string, exts: readonly string[]): Promise<boolean> {
  const found = await find(feed, id, exts);
  if (!found) return false;
  let gone = true;
  try {
    await unlink(/*turbopackIgnore: true*/ found.path);
  } catch (e) {
    if (!isErrno(e, "ENOENT")) throw e;
    gone = false;
  }
  await unlink(/*turbopackIgnore: true*/ sidecar(feed, id, found.ext)).catch((e) => {
    if (!isErrno(e, "ENOENT")) throw e;
  });
  return gone;
}
