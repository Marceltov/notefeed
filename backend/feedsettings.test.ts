import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { readSettings, writeSettings } from "./data/settings";
import { checkSettings, forReaders, getSettings } from "./feedsettings";
import { mdNote } from "./note/testing";

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-fs-"));
});

test("a settings file from before showSender reads as true", async () => {
  await mkdir(join(process.env.DATA_DIR!, "old"));
  await writeFile(join(process.env.DATA_DIR!, "old", ".feed.json"), JSON.stringify({ title: "T", description: "D" }));
  expect(await getSettings("old")).toEqual({ title: "T", description: "D", image: "", showSender: true });
});

test("showSender is written only when false, so a file stays as it was without sign-in", async () => {
  const dir = join(process.env.DATA_DIR!, "f");
  await mkdir(dir);
  const s = { title: "T", description: "D", image: "", showSender: true };
  await writeSettings("f", s);
  expect(await readFile(join(dir, ".feed.json"), "utf8")).toBe('{"title":"T","description":"D","image":""}');
  expect(await readSettings("f")).toEqual(s);
  await writeSettings("f", { ...s, showSender: false });
  expect(await readFile(join(dir, ".feed.json"), "utf8")).toBe('{"title":"T","description":"D","image":"","showSender":false}');
  expect(await readSettings("f")).toEqual({ ...s, showSender: false });
});

test("forReaders drops the sender only when showSender is false", () => {
  const a = mdNote({ id: "1", markdown: "a", sender: "x@y.z" });
  const b = mdNote({ id: "2", markdown: "b" });
  expect(forReaders([a, b], { showSender: true })).toEqual([a, b]);
  const hidden = forReaders([a, b], { showSender: false });
  expect(hidden[0].sender).toBeUndefined();
  expect(hidden[0].title).toBe("a");
  expect(hidden[1]).toBe(b);
  expect(a.sender).toBe("x@y.z");
});

test("a title or description stored with what no title holds is shown cleaned", async () => {
  await mkdir(join(process.env.DATA_DIR!, "old"));
  await writeFile(join(process.env.DATA_DIR!, "old", ".feed.json"), JSON.stringify({ title: "Be\u202enign", description: "a\u2028b\u009b", image: "" }));
  expect(await getSettings("old")).toMatchObject({ title: "Be nign", description: "a b" });
});

test("checkSettings refuses C1 controls, line separators and text-direction overrides in a title and a description", () => {
  for (const bad of ["a\u009bb", "a\u2028b", "a\u2029b", "a\u202eb", "a\u2066b", "a\nb"]) {
    expect(() => checkSettings({ title: bad, description: "" }), JSON.stringify(bad)).toThrow(/title must be one line/);
    expect(() => checkSettings({ title: "", description: bad }), JSON.stringify(bad)).toThrow(/description must be one line/);
  }
  expect(checkSettings({ title: "\u05e9\u05dc\u05d5\u05dd\u200f", description: "" }).title).toBe("\u05e9\u05dc\u05d5\u05dd\u200f");
});
