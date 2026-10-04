// The file system backend: `<DATA_DIR>/<feed>/…` (ADR 0017, 0018).
import { config } from "../../config";
import type { Storage } from "../types";
import { createFeedMethods, type FeedDeps } from "./feedindex";
import { deleteNote, listNoteRefs, readFeedFile, readMeta, readNote, replaceNote, updateMeta, writeNote } from "./notes";
import { readHash, removeHash, writeHash } from "./password";
import { readSettings, writeSettings } from "./settings";

export function createFsStorage(deps: FeedDeps): Storage {
  return {
    ...createFeedMethods(deps, config.dataDir),
    writeNote, listNoteRefs, readNote, readMeta, replaceNote, updateMeta, deleteNote, readFile: readFeedFile,
    readSettings, writeSettings, readHash, writeHash, removeHash,
  };
}
