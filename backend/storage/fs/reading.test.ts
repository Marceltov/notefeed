// What reading costs on disk (#96), and that a stray entry in a feed folder cannot break it.
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { countNotes, createNote, getNote, listNotes } from "../../notes";

const calls = vi.hoisted(() => ({ readdir: 0, readFile: [] as string[] }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readdir: vi.fn(async (...a: Parameters<typeof fs.readdir>) => (calls.readdir++, (fs.readdir as (...x: unknown[]) => unknown)(...a))),
    readFile: vi.fn(async (...a: Parameters<typeof fs.readFile>) => (calls.readFile.push(String(a[0])), (fs.readFile as (...x: unknown[]) => unknown)(...a))),
  };
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "notefeed-"));
  process.env.DATA_DIR = root;
  calls.readdir = 0;
  calls.readFile = [];
});

const ids = async (n: number, tags: (i: number) => string[] = () => []) => {
  const made = [];
  for (let i = 0; i < n; i++) made.push((await createNote("f", `note ${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)), undefined, tags(i))).note.id);
  return made;
};

describe("the cost of reading", () => {
  test("reading one note by id lists the feed folder zero times", async () => {
    const [id] = await ids(3);
    calls.readdir = 0;
    expect((await getNote("f", id))?.id).toBe(id);
    expect(calls.readdir).toBe(0);
  });
  test("listing a page of notes reads the folder once", async () => {
    await ids(12);
    calls.readdir = 0;
    expect(await listNotes("f", 10)).toHaveLength(10);
    expect(calls.readdir).toBe(1);
  });
  test("a tag filter reads the text only of the notes it returns", async () => {
    await ids(8, (i) => (i % 4 === 0 ? ["rare"] : ["common"]));
    calls.readFile = [];
    const found = await listNotes("f", 50, undefined, "rare");
    expect(found).toHaveLength(2);
    expect(calls.readFile.filter((p) => p.endsWith(".md"))).toHaveLength(2);
  });
});

describe("hand-placed oddities are not notes, and never an error", () => {
  test("a folder named like a note, a sidecar that is a folder and a link", async () => {
    const [good] = await ids(1);
    await mkdir(join(root, "f", "x.md"));
    const second = (await createNote("f", "two", new Date(Date.UTC(2026, 0, 2)))).note.id;
    await rmSidecarAsFolder(second);
    await symlink(join(root, "f", `${good}.md`), join(root, "f", "linked.md"));
    const listed = await listNotes("f", 50);
    expect(listed.map((n) => n.id).sort()).toEqual([good, second].sort());
    expect(await countNotes("f")).toBe(2);
    expect(await getNote("f", "x")).toBeNull();
    expect(await getNote("f", "linked")).toBeNull();
  });
});

// The sidecar of `id` becomes a folder: its metadata reads as none.
async function rmSidecarAsFolder(id: string) {
  await mkdir(join(root, "f", `.${id}.md.json`));
}
