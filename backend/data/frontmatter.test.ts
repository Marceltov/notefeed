import { describe, expect, test } from "vitest";
import { decode, encode } from "./frontmatter";

describe("frontmatter", () => {
  test("every note gets a block, empty without metadata", () => {
    expect(encode("# hi", {})).toBe("---\n---\n# hi");
    expect(decode("---\n---\n# hi")).toEqual({ markdown: "# hi", meta: {} });
  });
  test("meta lines are JSON, alphabetical by key", () => {
    expect(encode("hello", { sender: "Ann", agent: 1 })).toBe('---\nagent: 1\nsender: "Ann"\n---\nhello');
    expect(decode(encode("hello", { sender: "Ann", agent: 1 }))).toEqual({ markdown: "hello", meta: { agent: 1, sender: "Ann" }, sender: "Ann" });
  });
  test("round trips a sender, JSON-quoted", () => {
    const odd = 'A: "B"\nC ---';
    expect(decode(encode("x", { sender: odd }))).toEqual({ markdown: "x", meta: { sender: odd }, sender: odd });
  });
  test.each(["a b", "a b", "a\rb", "  \r\n"])("round trips the sender %j", (sender) => {
    expect(decode(encode("hi", { sender }))).toEqual({ markdown: "hi", meta: { sender }, sender });
  });
  test("a typed block is always body, never metadata", () => {
    const typed = '---\nsender: "Boss"\n---\nhi';
    expect(encode(typed, {})).toBe("---\n---\n" + typed);
    expect(decode(encode(typed, {}))).toEqual({ markdown: typed, meta: {} });
    expect(decode(encode(typed, { sender: "Ann" }))).toEqual({ markdown: typed, meta: { sender: "Ann" }, sender: "Ann" });
  });
  test.each([
    ["no block", "# hi"],
    ["non-JSON value", "---\ntitle: x\n---\ntext"],
    ["invalid JSON", '---\nsender: "Ann\n---\ntext'],
    ["bad key", '---\nSender: "x"\n---\ntext'],
    ["CRLF", '---\r\nsender: "x"\r\n---\r\ntext'],
    ["no closing line", '---\nsender: "x"\ntext'],
  ])("legacy file (%s) is all body", (_n, raw) => {
    expect(decode(raw)).toEqual({ markdown: raw, meta: {} });
  });
  test("encode skips values JSON cannot write and round-trips", () => {
    expect(encode("x", { sender: undefined, f: () => 1 })).toBe("---\n---\nx");
    expect(decode(encode("x", { sender: undefined }))).toEqual({ markdown: "x", meta: {} });
  });
  test("encode throws on a key decode would reject", () => {
    expect(() => encode("x", { Bad: 1 })).toThrow(Error);
  });
  test("a non-string sender is kept in meta but is no sender", () => {
    expect(decode("---\nsender: 5\n---\nt")).toEqual({ markdown: "t", meta: { sender: 5 } });
  });
});
