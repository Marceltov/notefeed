// The storage backend of this process, chosen by NOTEFEED_STORAGE. One instance per configuration; processState because Next may
// bundle this module once per route.
import { config } from "../config";
import { processState } from "../state";
import type { Storage } from "./types";

export type { Storage } from "./types";

const state = processState("storage", () => ({}) as { key?: string; instance?: Storage });

// Replaced by the real backends in the tasks that add them.
function build(kind: ReturnType<typeof config.storage>): Storage {
  return new Proxy({} as Storage, {
    get: (_t, method) => () => {
      throw new Error(`storage "${kind}" is not implemented yet (${String(method)})`);
    },
  });
}

export function storage(): Storage {
  const kind = config.storage(); // throws for an unknown value
  const key = JSON.stringify([kind, config.dataDir(), config.databaseUrl()]);
  if (state.instance && state.key === key) return state.instance;
  state.key = key;
  return (state.instance = build(kind));
}

export const resetStorageForTests = (): void => {
  state.key = undefined;
  state.instance = undefined;
};
