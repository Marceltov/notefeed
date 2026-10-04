import { expect, test } from "vitest";
import { imgNote, mdNote } from "./testing";

// A value stored before the rule, or edited by hand, is shown without what no title, alt text or sender holds.
test("a stored title, sender and alt text come out cleaned, a derived title too", () => {
  expect(mdNote({ id: "a", markdown: "# x", title: "Be\u202enign", sender: "An\u2028n" })).toMatchObject({ title: "Be nign", sender: "An n" });
  expect(mdNote({ id: "a", markdown: "# Head\u202ee" }).title).toBe("Head e");
  expect(imgNote({ id: "b", title: "t\u009b" }).title).toBe("t");
  expect(imgNote({ id: "b" }).title).toBe("");
});

test("a note's alt text is cleaned on read", () => {
  const n = imgNote({ id: "b" });
  const dirty = n.withMeta({ ...n.meta, alt: "a\u202eb" });
  expect(dirty.alt).toBe("a b");
  expect(n.alt).toBeUndefined();
});
