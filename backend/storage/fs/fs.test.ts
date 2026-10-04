import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeStorage } from "../contract";
import { createFsStorage } from ".";

describeStorage("fs", async () => {
  const root = await mkdtemp(join(tmpdir(), "notefeed-"));
  process.env.DATA_DIR = root;
  return {
    storage: createFsStorage({ derivedReadId: (feed) => `derived-${feed}`, isReadId: (id) => /^[A-Za-z0-9_-]{3,64}$/.test(id), isFeedName: (n) => /^[a-z0-9_-]{1,64}$/.test(n) }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
});
