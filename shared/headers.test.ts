import { expect, test } from "vitest";
import { decodeHeaderValue, encodeHeaderValue } from "./headers";

test("a value survives a round trip through a header that only holds bytes", () => {
  for (const s of ["Café", "日本語 🎉", "plain", "", "Größe.png"]) {
    const wire = encodeHeaderValue(s);
    expect([...wire].every((c) => c.charCodeAt(0) <= 255)).toBe(true); // fetch accepts it
    expect(decodeHeaderValue(wire)).toBe(s);
  }
});

test("ASCII is sent as it is", () => {
  expect(encodeHeaderValue("cat.png")).toBe("cat.png");
});

test("what a server reads from raw UTF-8 bytes (curl -H 'X-Note-Title: Café') is decoded", () => {
  expect(decodeHeaderValue("CafÃ©")).toBe("Café"); // Node hands header bytes over as latin1
});

test("a value that is not UTF-8 bytes, or already holds real characters, is left as it is", () => {
  expect(decodeHeaderValue("Caf\xe9")).toBe("Caf\xe9"); // a lone latin1 é is not valid UTF-8
  expect(decodeHeaderValue("日本語")).toBe("日本語");
});
