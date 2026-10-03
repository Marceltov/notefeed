import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { cookieValue, createProtected } from "./feedlock";
import { readIdOf, resetFeedsForTests } from "./feeds";
import { feedUnlocked, getFeed, getFeedImages, getFeedNote, getReadFeed, getReadNote, identitySender, passwordSet, signInProviders } from "./index";
import { sign } from "./oauth/tokens";
import { createImageNote, createNote, removeNote } from "./notes";
import { saveSettings } from "./feedsettings";

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

test("getFeedImages lists the feed's image notes, newest first, with their path under the read id; markdown notes are not in it", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  await createNote("pics", "# Text", new Date("2026-01-01T00:00:00Z"));
  const a = (await createImageNote("pics", png, { title: "First" }, new Date("2026-01-02T00:00:00Z"))).note;
  const b = (await createImageNote("pics", png, {}, new Date("2026-01-03T00:00:00Z"))).note;
  const rid = (await readIdOf("pics"))!;
  expect(await getFeedImages("pics")).toEqual([
    { file: b.file, url: `/r/${rid}/${b.file}`, title: "" },
    { file: a.file, url: `/r/${rid}/${a.file}`, title: "First" },
  ]);
  expect(await getFeedImages("none")).toEqual([]);
  expect(await getFeedImages("login")).toEqual([]);
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

test("signInProviders lists each provider's id and label in order, empty while identity is off; passwordSet follows the password", () => {
  const vars = {
    NOTEFEED_OIDC_ISSUER: "https://auth.example.com/realm/x",
    NOTEFEED_OIDC_CLIENT_ID: "id",
    NOTEFEED_OIDC_CLIENT_SECRET: "s",
    NOTEFEED_OIDC_ALLOW: "*",
    NOTEFEED_OIDC_MY_IDP_ISSUER: "https://idp.example",
    NOTEFEED_OIDC_MY_IDP_CLIENT_ID: "id",
    NOTEFEED_OIDC_MY_IDP_CLIENT_SECRET: "s",
    NOTEFEED_OIDC_MY_IDP_ALLOW: "*",
    NOTEFEED_OIDC_MY_IDP_LABEL: "My IdP",
  };
  expect(signInProviders()).toEqual([]);
  Object.assign(process.env, vars);
  process.env.NOTEFEED_PASSWORD = "";
  try {
    expect(signInProviders()).toEqual([
      { id: "default", label: "auth.example.com" },
      { id: "my_idp", label: "My IdP" },
    ]);
    expect(passwordSet()).toBe(false);
    process.env.NOTEFEED_PASSWORD = "x";
    expect(passwordSet()).toBe(true);
  } finally {
    for (const k of Object.keys(vars)) delete process.env[k];
    delete process.env.NOTEFEED_PASSWORD;
  }
  expect(signInProviders()).toEqual([]);
});

test("read pages hide the sender when the feed says so; getFeed never does", async () => {
  const { note } = await createNote("s", "# Hi", undefined, "Ann");
  const rid = (await readIdOf("s"))!;
  expect((await getReadFeed(rid))!.notes[0].sender).toBe("Ann");
  expect((await getReadNote(rid, note.id))!.sender).toBe("Ann");
  await saveSettings("s", { title: "", description: "", image: "", showSender: false });
  expect((await getReadFeed(rid))!.notes[0].sender).toBeUndefined();
  expect((await getReadNote(rid, note.id))!.sender).toBeUndefined();
  expect((await getFeed("s"))!.notes[0].sender).toBe("Ann");
  expect((await getFeedNote("s", note.id))!.sender).toBe("Ann");
});

// The compose box says "your name is shown" only to someone signed in through the provider.
test("identitySender names the signed-in person only while sign-in is on", () => {
  const vars = { NOTEFEED_OIDC_ISSUER: "https://auth.example.com", NOTEFEED_OIDC_CLIENT_ID: "id", NOTEFEED_OIDC_CLIENT_SECRET: "s", NOTEFEED_OIDC_ALLOW: "*" };
  process.env.NOTEFEED_PASSWORD = "pw";
  const c = sign("identity", { sender: "Ann" });
  try {
    expect(identitySender(c)).toBeUndefined();
    Object.assign(process.env, vars);
    expect(identitySender(c)).toBe("Ann");
    expect(identitySender(undefined)).toBeUndefined(); // a password session has no identity cookie
  } finally {
    for (const k of Object.keys(vars)) delete process.env[k];
    delete process.env.NOTEFEED_PASSWORD;
  }
});
