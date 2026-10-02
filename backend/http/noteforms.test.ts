import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { cookieValue, createProtected, feedCookieName } from "../feedlock";
import { resetFeedsForTests } from "../feeds";
import { resetRateLimitsForTests } from "../limits";
import { createNote, getNote } from "../notes";
import { noteFormRoute } from "./noteforms";

let id: string;
beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-nf-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  delete process.env.NOTEFEED_RATE_LIMIT;
  resetFeedsForTests();
  resetRateLimitsForTests();
  id = (await createNote("openfeed", "# Old")).id;
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

// The edit form posts multipart, like the compose box (a urlencoded body would be a third larger for non-ASCII text).
const send = (feed: string, noteId: string, action: string, fields: Record<string, string> = {}, origin: string | null = "http://localhost:3000", cookie?: string, body?: BodyInit, type?: string) =>
  noteFormRoute(
    new Request(`http://localhost:3000/${feed}/${noteId}/${action}`, {
      method: "POST",
      headers: {
        host: "localhost:3000",
        ...(type ? { "content-type": type } : {}),
        ...(origin ? { origin } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ?? form(fields),
    }),
    feed,
    noteId,
    action,
  );
const loc = (r: Response) => r.headers.get("location");

test("edit replaces the text and goes to the note", async () => {
  const res = await send("openfeed", id, "edit", { markdown: "# New" });
  expect(res.status).toBe(303);
  expect(loc(res)).toBe(`/openfeed/${id}?edited=1`);
  expect((await getNote("openfeed", id))?.markdown).toBe("# New");
});

test("delete removes the note and goes to the feed", async () => {
  const res = await send("openfeed", id, "delete");
  expect(res.status).toBe(303);
  expect(loc(res)).toBe(`/openfeed?deleted=${id}`);
  expect(await getNote("openfeed", id)).toBeNull();
});

test.each([["another site", "https://evil.example"], ["no Origin", null]])("from %s: refused, nothing changed", async (_, origin) => {
  expect(loc(await send("openfeed", id, "edit", { markdown: "# Hacked" }, origin))).toBe(`/openfeed/${id}?error=auth`);
  expect(loc(await send("openfeed", id, "delete", {}, origin))).toBe(`/openfeed/${id}?error=auth`);
  expect((await getNote("openfeed", id))?.markdown).toBe("# Old");
});

test("refusals go back to the note with the code", async () => {
  expect(loc(await send("openfeed", id, "edit", { markdown: "  " }))).toBe(`/openfeed/${id}?error=empty_note`);
  expect(loc(await send("openfeed", "nope", "edit", { markdown: "# x" }))).toBe("/openfeed/nope?error=not_found");
  });

test("rate limited: the wait is passed on", async () => {
  process.env.NOTEFEED_RATE_LIMIT = "1";
  await send("openfeed", id, "edit", { markdown: "# a" });
  expect(loc(await send("openfeed", id, "edit", { markdown: "# b" }))).toMatch(/\?error=rate_limited&retry=\d+$/);
});

test("a note near the limit in non-ASCII text saves", async () => {
  const markdown = "# " + "あ".repeat(33_000); // about 99 KB of UTF-8, 3x that urlencoded
  expect(loc(await send("openfeed", id, "edit", { markdown }))).toBe(`/openfeed/${id}?edited=1`);
  expect((await getNote("openfeed", id))?.markdown).toBe(markdown);
});

test("a urlencoded edit body is refused, the note untouched", async () => {
  const res = await send("openfeed", id, "edit", {}, undefined, undefined, "markdown=%23+Raw", "application/x-www-form-urlencoded");
  expect(loc(res)).toBe(`/openfeed/${id}?error=invalid_body`);
  expect((await getNote("openfeed", id))?.markdown).toBe("# Old");
});

test("deleting a note that is already gone still lands on the feed (a double click)", async () => {
  await send("openfeed", id, "delete");
  expect(loc(await send("openfeed", id, "delete"))).toBe(`/openfeed?deleted=${id}`);
});

test("an unknown action is a 404", async () => {
  expect((await send("openfeed", id, "bogus")).status).toBe(404);
});

test("a protected feed needs its cookie", async () => {
  await createProtected("lockd", "pw");
  const lid = (await createNote("lockd", "# Old")).id;
  expect(loc(await send("lockd", lid, "edit", { markdown: "# New" }))).toBe(`/lockd/${lid}?error=auth`);
  expect((await getNote("lockd", lid))?.markdown).toBe("# Old");
  const cookie = `${feedCookieName("lockd")}=${await cookieValue("lockd")}`;
  expect(loc(await send("lockd", lid, "edit", { markdown: "# New" }, "http://localhost:3000", cookie))).toBe(`/lockd/${lid}?edited=1`);
  expect(loc(await send("lockd", lid, "delete", {}, "http://localhost:3000", cookie))).toBe(`/lockd?deleted=${lid}`);
});

test("an invalid feed name is a 400", async () => {
  expect((await send("a%2Fb", id, "edit", { markdown: "# x" })).status).toBe(400);
});
