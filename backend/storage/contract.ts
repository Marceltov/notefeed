// The tests every Storage backend must pass. A backend's test file calls describeStorage() with a factory for a fresh, empty store.
import { describe, expect, test } from "vitest";
import { NotFoundError, ReadIdTakenError } from "../errors";
import { FeedGoneError, type Storage } from "./types";

export type Harness = {
  storage: Storage;
  cleanup(): Promise<void>;
};

const MD = ["md"];
const makeFeed = async (s: Storage, name: string, readId = `rid-${name}`) => void (await s.createFeed(name, readId));
const ALL = ["md", "png"];
const text = (b: Buffer | undefined) => b?.toString("utf8");

export function describeStorage(name: string, make: () => Promise<Harness>): void {
  describe(`storage contract: ${name}`, () => {
    // Each test gets a fresh store; a test body receives the harness.
    const t = (title: string, body: (h: Harness) => Promise<void>) =>
      test(title, async () => {
        const h = await make();
        try {
          await makeFeed(h.storage, "f");
          await body(h);
        } finally {
          await h.cleanup();
        }
      });

    describe("notes", () => {
      t("writeNote returns the id and readNote gives the note back byte for byte", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "md", "# T\r\nx", { sender: "Ann", tags: ["ci"] });
        expect(id).toBe("a");
        const n = await s.readNote("f", id, MD, () => true);
        expect(text(n?.content)).toBe("# T\r\nx");
        expect(n?.ext).toBe("md");
        expect(n?.meta).toEqual({ sender: "Ann", tags: ["ci"] });
        expect(n?.mtime).toBeInstanceOf(Date);
      });
      t("a note without metadata reads as {}", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "md", "x", {});
        expect((await s.readNote("f", id, MD, () => true))?.meta).toEqual({});
      });
      t("a taken id gets -2, -3 and never overwrites", async ({ storage: s }) => {
        expect(await s.writeNote("f", "a", "md", "one", {})).toBe("a");
        expect(await s.writeNote("f", "a", "md", "two", { sender: "S" })).toBe("a-2");
        expect(await s.writeNote("f", "a", "md", "three", {})).toBe("a-3");
        expect(text((await s.readNote("f", "a", MD, () => true))?.content)).toBe("one");
      });
      t("concurrent writes with one base get different ids and lose nothing", async ({ storage: s }) => {
        const ids = await Promise.all([1, 2, 3, 4, 5].map((i) => s.writeNote("f", "a", "md", `n${i}`, {})));
        expect(new Set(ids).size).toBe(5);
        const bodies = await Promise.all(ids.map(async (id) => text((await s.readNote("f", id, MD, () => true))?.content)));
        expect(bodies.sort()).toEqual(["n1", "n2", "n3", "n4", "n5"]);
      });
      t("binary content that is not UTF-8 and holds NUL bytes round-trips", async ({ storage: s }) => {
        const bytes = new Uint8Array([0x89, 0, 0xff, 0xfe, 0, 0x50]);
        const id = await s.writeNote("f", "a", "png", bytes, {});
        expect([...((await s.readNote("f", id, ALL, () => true))?.content ?? [])]).toEqual([...bytes]);
        expect([...((await s.readFile("f", `${id}.png`)) ?? [])]).toEqual([...bytes]);
      });
      t("withContent false gives the size and empty content", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "png", new Uint8Array(1000), {});
        const full = await s.readNote("f", id, ALL, () => true);
        expect([full?.size, full?.content.length]).toEqual([1000, 1000]);
        const lean = await s.readNote("f", id, ALL, () => false);
        expect([lean?.size, lean?.content.length]).toEqual([1000, 0]);
        expect((await s.readNote("f", id, ALL, (ext) => ext === "md"))?.content.length).toBe(0);
      });
      t("readNote only finds the accepted extensions, and a missing note is null", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "png", new Uint8Array([1]), {});
        expect(await s.readNote("f", id, MD, () => true)).toBeNull();
        expect(await s.readNote("f", "nope", ALL, () => true)).toBeNull();
        expect(await s.readNote("missing", "a", ALL, () => true)).toBeNull();
      });
      t("listNoteRefs lists every note once, and a missing feed as empty", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", { sender: "S" });
        await s.writeNote("f", "b", "png", new Uint8Array([1]), {});
        const refs = (await s.listNoteRefs("f")).sort((x, y) => x.id.localeCompare(y.id));
        expect(refs).toEqual([{ id: "a", ext: "md" }, { id: "b", ext: "png" }]);
        expect(await s.listNoteRefs("missing")).toEqual([]);
      });
      t("readMeta reads only the metadata", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", { title: "T", tags: ["a"] });
        expect(await s.readMeta("f", { id: "a", ext: "md" })).toEqual({ title: "T", tags: ["a"] });
        expect(await s.readMeta("f", { id: "nope", ext: "md" })).toBeNull();
      });
      t("replaceNote changes the content, keeps the metadata, and is false for a missing note", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "md", "old", { sender: "S" });
        expect(await s.replaceNote("f", id, MD, "new")).toBe(true);
        const n = await s.readNote("f", id, MD, () => true);
        expect([text(n?.content), n?.meta]).toEqual(["new", { sender: "S" }]);
        expect(await s.replaceNote("f", "nope", MD, "x")).toBe(false);
        expect(await s.listNoteRefs("f")).toEqual([{ id, ext: "md" }]);
      });
      t("updateMeta sets, removes with null, and is false for a missing note", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "md", "x", { sender: "S", title: "T" });
        expect(await s.updateMeta("f", id, MD, { title: "U", sender: null })).toBe(true);
        expect((await s.readNote("f", id, MD, () => true))?.meta).toEqual({ title: "U" });
        expect(await s.updateMeta("f", id, MD, { title: "" })).toBe(true);
        expect((await s.readNote("f", id, MD, () => true))?.meta).toEqual({});
        expect(await s.updateMeta("f", "nope", MD, { title: "x" })).toBe(false);
      });
      t("deleteNote removes the note, a second delete is false", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "md", "x", { sender: "S" });
        expect(await s.deleteNote("f", id, MD)).toBe(true);
        expect(await s.listNoteRefs("f")).toEqual([]);
        expect(await s.readMeta("f", { id, ext: "md" })).toBeNull();
        expect(await s.deleteNote("f", id, MD)).toBe(false);
      });
      t("readFile gives a note's bytes by name, and null for any other name", async ({ storage: s }) => {
        const id = await s.writeNote("f", "a", "md", "hello", {});
        expect(text((await s.readFile("f", `${id}.md`)) ?? undefined)).toBe("hello");
        for (const n of ["nope.md", ".readid", "../x.md", "a", "a.b.md", ""]) expect(await s.readFile("f", n)).toBeNull();
      });
      t("writeNote to a feed deleted meanwhile throws FeedGoneError", async (h) => {
        await h.storage.deleteFeed("f");
        await expect(h.storage.writeNote("f", "a", "md", "x", {})).rejects.toBeInstanceOf(FeedGoneError);
      });
    });

    describe("the feed's own values", () => {
      t("settings: a missing value is the default, a write round-trips", async ({ storage: s }) => {
        expect(await s.readSettings("f")).toEqual({ title: "", description: "", image: "", showSender: true });
        const set = { title: "T", description: "D", image: "a.png", showSender: false };
        await s.writeSettings("f", set);
        expect(await s.readSettings("f")).toEqual(set);
      });
      t("the password hash: none, write, read, remove", async ({ storage: s }) => {
        expect(await s.readHash("f")).toBeNull();
        await s.writeHash("f", "h1");
        expect(await s.readHash("f")).toBe("h1");
        await s.writeHash("f", "h2");
        expect(await s.readHash("f")).toBe("h2");
        await s.removeHash("f");
        expect(await s.readHash("f")).toBeNull();
      });
      t("writing settings or a hash to a deleted feed throws FeedGoneError", async (h) => {
        await h.storage.deleteFeed("f");
        await expect(h.storage.writeSettings("f", { title: "", description: "", image: "", showSender: true })).rejects.toBeInstanceOf(FeedGoneError);
        await expect(h.storage.writeHash("f", "x")).rejects.toBeInstanceOf(FeedGoneError);
      });
    });

    describe("feeds", () => {
      t("createFeed makes a feed with its read id, once", async ({ storage: s }) => {
        expect(await s.createFeed("g", "gid-123")).toEqual({ created: true });
        expect(await s.feedReadId("g")).toBe("gid-123");
        expect(await s.createFeed("g", "other-id")).toEqual({ created: false });
        expect(await s.feedReadId("g")).toBe("gid-123");
        expect(await s.feedForReadId("other-id")).toBeNull();
      });
      t("feedReadId is undefined for a missing feed, feedForReadId null for an unknown id", async ({ storage: s }) => {
        expect(await s.feedReadId("nope")).toBeUndefined();
        expect(await s.feedForReadId("nope-id")).toBeNull();
      });
      t("two creations of one name at once: exactly one is created", async ({ storage: s }) => {
        const r = await Promise.all([s.createFeed("g", "id-one"), s.createFeed("g", "id-two"), s.createFeed("g", "id-three")]);
        expect(r.filter((x) => x.created)).toHaveLength(1);
        expect(await s.feedCount()).toBe(2); // f and g
      });
      t("two feeds asking for one read id at once: one wins, the other is ReadIdTakenError", async ({ storage: s }) => {
        const r = await Promise.allSettled([s.createFeed("g", "same-id"), s.createFeed("h", "same-id")]);
        expect(r.filter((x) => x.status === "fulfilled" && x.value.created)).toHaveLength(1);
        const lost = r.find((x) => x.status === "rejected");
        expect(lost && "reason" in lost && lost.reason).toBeInstanceOf(ReadIdTakenError);
        expect(await s.feedCount()).toBe(2);
      });
      t("a taken read id is ReadIdTakenError and creates nothing", async ({ storage: s }) => {
        await expect(s.createFeed("g", "rid-f")).rejects.toBeInstanceOf(ReadIdTakenError);
        expect(await s.feedReadId("g")).toBeUndefined();
      });
      t("createFeed with a hash is protected from the start", async ({ storage: s }) => {
        await s.createFeed("g", "gid-123", "the-hash");
        expect(await s.readHash("g")).toBe("the-hash");
      });
      t("setReadId changes it and frees the old one", async ({ storage: s }) => {
        await s.setReadId("f", "new-id-1");
        expect(await s.feedReadId("f")).toBe("new-id-1");
        expect(await s.feedForReadId("new-id-1")).toBe("f");
        expect(await s.feedForReadId("rid-f")).toBeNull();
        await s.createFeed("g", "rid-f"); // the old id is free again
      });
      t("setReadId: a taken id is ReadIdTakenError, a missing feed is NotFoundError", async ({ storage: s }) => {
        await s.createFeed("g", "gid-123");
        await expect(s.setReadId("f", "gid-123")).rejects.toBeInstanceOf(ReadIdTakenError);
        expect(await s.feedReadId("f")).toBe("rid-f");
        await expect(s.setReadId("nope", "whatever-1")).rejects.toBeInstanceOf(NotFoundError);
      });
      t("deleteFeed removes the notes, the hash and the settings, and frees the read id", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", {});
        await s.writeHash("f", "h");
        await s.writeSettings("f", { title: "T", description: "", image: "", showSender: true });
        expect(await s.deleteFeed("f")).toBe(true);
        expect(await s.feedReadId("f")).toBeUndefined();
        expect(await s.listNoteRefs("f")).toEqual([]);
        expect(await s.readHash("f")).toBeNull();
        expect((await s.readSettings("f")).title).toBe("");
        expect(await s.deleteFeed("f")).toBe(false);
        await s.createFeed("g", "rid-f");
        await s.createFeed("f", "fresh-id-9"); // the same name again is a new, empty feed
        expect(await s.listNoteRefs("f")).toEqual([]);
        expect(await s.readHash("f")).toBeNull();
      });
      t("listFeeds, listFeedNames and feedCount agree", async ({ storage: s }) => {
        await s.createFeed("g", "gid-123");
        expect((await s.listFeeds()).sort()).toEqual(["f", "g"]);
        expect((await s.listFeedNames()).sort()).toEqual(["f", "g"]);
        expect(await s.feedCount()).toBe(2);
      });
      t("a feed name and a read id of 64 characters work", async ({ storage: s }) => {
        const name = "n".repeat(64);
        const id = "r".repeat(64);
        await s.createFeed(name, id);
        expect(await s.feedForReadId(id)).toBe(name);
        await s.writeNote(name, "a", "md", "x", {});
        expect(await s.listNoteRefs(name)).toEqual([{ id: "a", ext: "md" }]);
      });
      t("forgetFeed never removes a feed that is still there under another id", async ({ storage: s }) => {
        await s.writeNote("f", "a", "md", "x", {});
        await s.forgetFeed("f", "not-its-id");
        expect(await s.feedReadId("f")).toBe("rid-f");
        expect(await s.listNoteRefs("f")).toEqual([{ id: "a", ext: "md" }]);
      });
    });
  });
}
