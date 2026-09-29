import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

// Simulate a write that fails partway (e.g. disk full) after some bytes hit the temp file.
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    writeFile: vi.fn(async (path: string) => {
      await fs.writeFile(path, "partial");
      throw Object.assign(new Error("no space"), { code: "ENOSPC" });
    }),
  };
});

test("a failed write leaves no partial file behind", async () => {
  const { createNote } = await import("./notes");
  const dir = await mkdtemp(join(tmpdir(), "notefeed-fail-"));
  process.env.DATA_DIR = dir;
  await expect(createNote("# Hi")).rejects.toThrow("no space");
  expect(await readdir(dir)).toEqual([]);
});
