import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

// The feed is deleted while a password change is waiting for its hash.
vi.mock("./data/password", async (importOriginal) => {
  const m = await importOriginal<typeof import("./data/password")>();
  const { feedDir } = await import("./data/fs");
  return { ...m, writeHash: async (feed: string, hash: string) => (await rm(feedDir(feed), { recursive: true }), m.writeHash(feed, hash)) };
});

test("changing the password of a feed deleted meanwhile is 404, not a 500", async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-lockrace-"));
  process.env.NOTEFEED_SECRET = "x".repeat(32);
  const { createProtected, changePassword } = await import("./feedlock");
  const { NotFoundError } = await import("./errors");
  await createProtected("locked", "correct horse");
  await expect(changePassword("locked", "correct horse", "another one", "ip")).rejects.toBeInstanceOf(NotFoundError);
});
