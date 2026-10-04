import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

// The content cannot be linked into place (after its sidecar was written).
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, link: vi.fn(async () => Promise.reject(Object.assign(new Error("io"), { code: "EIO" }))) };
});

test("a failure after the sidecar leaves no sidecar, no temp file, and nothing listed", async () => {
  const { writeNote, listNoteRefs } = await import("./notes");
  const root = await mkdtemp(join(tmpdir(), "notefeed-fail-"));
  process.env.DATA_DIR = root;
  await mkdir(join(root, "f"));
  await expect(writeNote("f", "a", "md", "x", { sender: "S" })).rejects.toThrow("io");
  expect(await readdir(join(root, "f"))).toEqual([]);
  expect(await listNoteRefs("f")).toEqual([]);
});
