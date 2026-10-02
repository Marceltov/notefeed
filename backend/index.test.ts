import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { cookieValue, createProtected } from "./feedlock";
import { readIdOf, resetFeedsForTests } from "./feeds";
import { feedUnlocked, getFeed, passwordSet, providerName } from "./index";
import { createNote, removeNote } from "./notes";

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-index-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  resetFeedsForTests();
});

// The read id is derived from the name: shown for a name nobody has posted to yet, a stranger could
// collect it and read the feed once someone creates it, protected or not.
test("getFeed gives no read id until the feed has a note", async () => {
  expect(await getFeed("soon")).toEqual({ notes: [], readId: null, exists: false, title: "", description: "", image: "", showSender: true, imageUrl: null });
  await createProtected("soon", "pw");
  expect(await getFeed("soon")).toEqual({ notes: [], readId: null, exists: true, title: "", description: "", image: "", showSender: true, imageUrl: null });
  await createNote("soon", "# Hi");
  expect((await getFeed("soon"))!.readId).toBe((await readIdOf("soon"))!);
  expect(await getFeed("login")).toBeNull();
});

test("getFeed says whether the feed exists: an emptied one still does", async () => {
  const { id } = (await createNote("emptied", "# Hi")).note;
  expect((await getFeed("emptied"))!.exists).toBe(true);
  await removeNote("emptied", id);
  expect(await getFeed("emptied")).toEqual({ notes: [], readId: null, exists: true, title: "", description: "", image: "", showSender: true, imageUrl: null });
});

test("feedUnlocked: open without a password, unlocked only by this feed's cookie", async () => {
  expect(await feedUnlocked("nobody", undefined)).toBe("open");
  expect(await feedUnlocked("Not a feed", "x")).toBe("open");
  await createProtected("a", "pw");
  await createProtected("b", "pw");
  expect(await feedUnlocked("a", undefined)).toBe("locked");
  expect(await feedUnlocked("a", "")).toBe("locked");
  expect(await feedUnlocked("a", (await cookieValue("b"))!)).toBe("locked");
  expect(await feedUnlocked("a", (await cookieValue("a"))!)).toBe("unlocked");
});

test("providerName is the issuer's host while identity is on, else empty; passwordSet follows the password", () => {
  const vars = { NOTEFEED_OIDC_ISSUER: "https://auth.example.com/realm/x", NOTEFEED_OIDC_CLIENT_ID: "id", NOTEFEED_OIDC_CLIENT_SECRET: "s", NOTEFEED_OIDC_ALLOW: "*" };
  expect(providerName()).toBe("");
  Object.assign(process.env, vars);
  process.env.NOTEFEED_PASSWORD = "";
  try {
    expect(providerName()).toBe("auth.example.com");
    expect(passwordSet()).toBe(false);
    process.env.NOTEFEED_PASSWORD = "x";
    expect(passwordSet()).toBe(true);
  } finally {
    for (const k of Object.keys(vars)) delete process.env[k];
    delete process.env.NOTEFEED_PASSWORD;
  }
  expect(providerName()).toBe("");
});
