// The file system backend: `<DATA_DIR>/<feed>/…` (ADR 0017, 0018).
import type { Storage } from "../types";
import { readSettings, writeSettings } from "./settings";
import { readHash, removeHash, writeHash } from "./password";
import { deleteNote, listNoteRefs, readFeedFile, readMeta, readNote, replaceNote, updateMeta, writeNote } from "./notes";

// The feed methods come with the next task.
const notYet = (): never => {
  throw new Error("fs storage: feeds are not behind the interface yet");
};

export function createFsStorage(): Storage {
  return {
    writeNote, listNoteRefs, readNote, readMeta, replaceNote, updateMeta, deleteNote, readFile: readFeedFile,
    readSettings, writeSettings, readHash, writeHash, removeHash,
    createFeed: notYet, deleteFeed: notYet, forgetFeed: notYet, setReadId: notYet, feedReadId: notYet,
    feedForReadId: notYet, listFeeds: notYet, listFeedNames: notYet, feedCount: notYet,
  };
}
