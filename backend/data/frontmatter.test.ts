import { describe, expect, test } from "vitest";
import { decode, encode } from "./frontmatter";

describe("frontmatter", () => {
  test("round trips a sender, JSON-quoted", () => {
    expect(encode("hello", "Ann")).toBe('---\nsender: "Ann"\n---\nhello');
    expect(decode(encode("hello", "Ann"))).toEqual({ markdown: "hello", sender: "Ann" });
    const odd = 'A: "B"\nC';
    expect(decode(encode("x", odd))).toEqual({ markdown: "x", sender: odd });
  });
  test("no sender and a plain body is the body unchanged", () => {
    expect(encode("# hi", undefined)).toBe("# hi");
    expect(decode("# hi")).toEqual({ markdown: "# hi" });
  });
  test("a body starting with --- gets an empty block ahead and decodes back exactly", () => {
    const body = "---\nrule above\n";
    expect(encode(body)).toBe("---\n---\n" + body);
    expect(decode(encode(body))).toEqual({ markdown: body });
  });
  test("a typed block is never taken for the sender", () => {
    const typed = '---\nsender: "Boss"\n---\nhi';
    expect(decode(encode(typed))).toEqual({ markdown: typed });
    expect(decode(encode(typed, "Ann"))).toEqual({ markdown: typed, sender: "Ann" });
  });
  test("a legacy block with an unknown key and non-JSON value is all body", () => {
    const raw = "---\ntitle: x\n---\ntext";
    expect(decode(raw)).toEqual({ markdown: raw });
  });
  test("unknown keys in a valid block are ignored and dropped on edit", () => {
    const raw = '---\nsender: "Ann"\nextra: 1\n---\nhi';
    const d = decode(raw);
    expect(d).toEqual({ markdown: "hi", sender: "Ann" });
    expect(encode(d.markdown, d.sender)).toBe('---\nsender: "Ann"\n---\nhi');
  });
});
