// The storage backend of this process, chosen by NOTEFEED_STORAGE. One instance per configuration; processState because Next may
// bundle this module once per route.
import { config } from "../config";
import { processState } from "../state";
import { checkFeed, isReadId } from "../feednames";
import { derivedReadId } from "../secret";
import { IMAGE_EXTS } from "../../shared/images";
import { createFsStorage } from "./fs";
import { createImageStore } from "./images";
import { connect } from "./sql/connect";
import { createSqlStorage } from "./sql";
import type { Storage } from "./types";

export type { Storage } from "./types";

const state = processState("storage", () => ({}) as { key?: string; instance?: Storage });

function build(kind: ReturnType<typeof config.storage>): Storage {
  config.validateStorage();
  if (kind === "fs") return createFsStorage({ derivedReadId, isReadId, isFeedName: (n) => checkFeed(n) === null });
  // Images are the notes whose bytes may live outside the database (NOTEFEED_IMAGES); text stays in its row.
  const store = createImageStore();
  return createSqlStorage(() => connect(kind, config.databaseUrl()), kind, store ? { store, external: (ext) => (IMAGE_EXTS as string[]).includes(ext) } : undefined);
}

export function storage(): Storage {
  const kind = config.storage(); // throws for an unknown value
  const key = JSON.stringify([kind, config.dataDir(), config.databaseUrl(), process.env.NOTEFEED_IMAGES ?? "", config.imagesDir(), config.s3()]);
  if (state.instance && state.key === key) return state.instance;
  state.key = key;
  return (state.instance = build(kind));
}

export const resetStorageForTests = (): void => {
  state.key = undefined;
  state.instance = undefined;
};
