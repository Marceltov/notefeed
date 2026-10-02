import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { readSettings, writeSettings } from "./data/settings";
import { forReaders, getSettings } from "./feedsettings";

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
  const a = { id: "1", title: "a", markdown: "a", createdAt: new Date(0), sender: "x@y.z" };
  const b = { id: "2", title: "b", markdown: "b", createdAt: new Date(0) };
  expect(forReaders([a, b], { showSender: true })).toEqual([a, b]);
  const hidden = forReaders([a, b], { showSender: false });
  expect(hidden[0]).not.toHaveProperty("sender");
  expect(hidden).toEqual([{ ...a, sender: undefined }, b]);
});
