import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

// The write of .readid fails (e.g. disk full): no feed directory may be left behind, or it would be
// indexed as a legacy feed after a restart.
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    writeFile: vi.fn(async (path: string, ...rest: unknown[]) => {
      if (String(path).endsWith(".readid")) throw Object.assign(new Error("no space"), { code: "ENOSPC" });
      return (fs.writeFile as (...a: unknown[]) => Promise<void>)(path, ...rest);
    }),
  };
});

test("a failed .readid write leaves no feed directory", async () => {
  const { ensureFeed, createProtectedFeed } = await import("../../feeds");
  const dir = await mkdtemp(join(tmpdir(), "notefeed-fail-"));
  process.env.DATA_DIR = dir;
  process.env.NOTEFEED_SECRET = "x".repeat(32);
  await expect(ensureFeed("test")).rejects.toThrow("no space");
  await expect(createProtectedFeed("locked", "hash")).rejects.toThrow("no space");
  expect(await readdir(dir)).toEqual([]);
});
