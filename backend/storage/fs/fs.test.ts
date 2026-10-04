import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
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

test("fs: forgetFeed with the feed's own id drops its index entry, e.g. after its folder was removed by hand", async () => {
  const root = await mkdtemp(join(tmpdir(), "notefeed-"));
  process.env.DATA_DIR = root;
  const s = createFsStorage({ derivedReadId: (feed) => `derived-${feed}`, isReadId: () => true, isFeedName: () => true });
  await s.createFeed("f", "rid-f");
  await s.forgetFeed("f", "rid-f");
  expect(await s.feedReadId("f")).toBeUndefined();
  await rm(root, { recursive: true, force: true });
});
