import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeStorage } from "../contract";
import { createFsStorage } from ".";

describeStorage("fs", async () => {
  const root = await mkdtemp(join(tmpdir(), "notefeed-"));
  process.env.DATA_DIR = root;
  return {
    storage: createFsStorage(),
    makeFeed: (name) => mkdir(join(root, name), { recursive: true }).then(() => undefined),
    dropFeed: (name) => rm(join(root, name), { recursive: true, force: true }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
});
