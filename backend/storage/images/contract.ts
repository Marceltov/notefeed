// The tests every ImageStore must pass. A store's test file calls describeImageStore() with a factory for a fresh, empty store.
import { describe, expect, test } from "vitest";
import { newKey, type ImageStore } from "./types";

export function describeImageStore(name: string, make: () => Promise<ImageStore>): void {
  describe(`image store contract: ${name}`, () => {
    test("put then get gives the bytes back unchanged, NUL bytes and all", async () => {
      const s = await make();
      const key = newKey();
      const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x00, 0x0a]);
      await s.put(key, bytes);
      expect(new Uint8Array((await s.get(key))!)).toEqual(bytes);
    });
    test("an empty object is an object", async () => {
      const s = await make();
      const key = newKey();
      await s.put(key, new Uint8Array());
      expect((await s.get(key))?.byteLength).toBe(0);
    });
    test("get of a key that was never put is null", async () => {
      expect(await (await make()).get(newKey())).toBeNull();
    });
    test("delete removes the object, and deleting again does not throw", async () => {
      const s = await make();
      const key = newKey();
      await s.put(key, Buffer.from("x"));
      await s.delete(key);
      expect(await s.get(key)).toBeNull();
      await expect(s.delete(key)).resolves.toBeUndefined();
    });
    test("put on an existing key replaces it", async () => {
      const s = await make();
      const key = newKey();
      await s.put(key, Buffer.from("one"));
      await s.put(key, Buffer.from("two!"));
      expect((await s.get(key))?.toString()).toBe("two!");
    });
    test("objects do not touch each other", async () => {
      const s = await make();
      const [a, b] = [newKey(), newKey()];
      await s.put(a, Buffer.from("a"));
      await s.put(b, Buffer.from("b"));
      await s.delete(a);
      expect((await s.get(b))?.toString()).toBe("b");
    });
    test("anything that is not a key is refused", async () => {
      const s = await make();
      for (const bad of ["", "../x", "a/b", "ABCDEF0123456789ABCDEF0123456789", "x".repeat(32)]) {
        await expect(s.put(bad, Buffer.from("x"))).rejects.toThrow(/not a key/);
        await expect(s.get(bad)).rejects.toThrow(/not a key/);
        await expect(s.delete(bad)).rejects.toThrow(/not a key/);
      }
    });
  });
}
