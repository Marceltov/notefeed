import { expect, test } from "vitest";
import { reportUrl } from "./report";

const v = { readId: "r1d", noteId: "20260930T100000Z-abc", file: "20260930T100000Z-abc.png" };

test("each placeholder is filled, percent-encoded, as often as it appears", () => {
  expect(reportUrl("https://r.example/?r={read_id}&n={note_id}&f={file}", v)).toBe("https://r.example/?r=r1d&n=20260930T100000Z-abc&f=20260930T100000Z-abc.png");
  expect(reportUrl("mailto:abuse@example.com?subject=Report%20{read_id}/{note_id}&body={note_id}", v)).toBe("mailto:abuse@example.com?subject=Report%20r1d/20260930T100000Z-abc&body=20260930T100000Z-abc");
  expect(reportUrl("https://r.example/{read_id}", { ...v, readId: "a b&c" })).toBe("https://r.example/a%20b%26c");
});

test("a template without placeholders, or with unknown ones, is left as it is", () => {
  expect(reportUrl("https://r.example/report", v)).toBe("https://r.example/report");
  expect(reportUrl("https://r.example/?x={feed}&n={note_id}", v)).toBe("https://r.example/?x={feed}&n=20260930T100000Z-abc");
});
