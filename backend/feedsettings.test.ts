import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { forReaders, getSettings } from "./feedsettings";

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-fs-"));
});

test("a settings file from before showSender reads as true", async () => {
  await mkdir(join(process.env.DATA_DIR!, "old"));
  await writeFile(join(process.env.DATA_DIR!, "old", ".feed.json"), JSON.stringify({ title: "T", description: "D" }));
  expect(await getSettings("old")).toEqual({ title: "T", description: "D", image: "", showSender: true });
});

test("forReaders drops the sender only when showSender is false", () => {
  const a = { id: "1", title: "a", markdown: "a", createdAt: new Date(0), sender: "x@y.z" };
  const b = { id: "2", title: "b", markdown: "b", createdAt: new Date(0) };
  expect(forReaders([a, b], { showSender: true })).toEqual([a, b]);
  const hidden = forReaders([a, b], { showSender: false });
  expect(hidden[0]).not.toHaveProperty("sender");
  expect(hidden).toEqual([{ ...a, sender: undefined }, b]);
});
