// postNoteAction is reachable by a direct server-action POST, so its own guards are a trust boundary.
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { SESSION_COOKIE, login as sessionFor } from "@/backend";
import { resetFeedsForTests } from "@/backend/feeds";
import { resetRateLimitsForTests } from "@/backend/limits";

let cookie: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === SESSION_COOKIE && cookie ? { value: cookie } : undefined),
    set: (n: string, v: string) => void (n === SESSION_COOKIE && (cookie = v)),
  }),
  headers: async () => new Headers({ host: "localhost:3000" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
const { loginAction, postNoteAction } = await import("./actions");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-action-"));
  process.env.DATA_DIR = dir;
  cookie = undefined;
  resetRateLimitsForTests();
  resetFeedsForTests();
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "NOTEFEED_MAX_FEEDS", "NOTEFEED_MAX_NOTES_PER_FEED", "NOTEFEED_TRUST_PROXY"])
    delete process.env[k];
});

const form = (markdown = "# Hi") => {
  const f = new FormData();
  f.set("markdown", markdown);
  return f;
};
const written = async () => (await readdir(dir)).filter((f) => f !== ".secret");

test("posts and redirects to the feed", async () => {
  await expect(postNoteAction("backups", null, form())).rejects.toThrow(/^REDIRECT \/backups\?posted=/);
  expect(await readdir(join(dir, "backups"))).toHaveLength(1);
});

test.each([
  ["Bad Name", "Invalid feed name."],
  ["../x", "Invalid feed name."],
  ["login", "That feed name is reserved."],
])("rejects feed %j, writes nothing", async (feed, msg) => {
  expect(await postNoteAction(feed, null, form())).toBe(msg);
  expect(await written()).toEqual([]);
});

test("locked instance without a session: redirect to /login, nothing written", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  await expect(postNoteAction("backups", null, form())).rejects.toThrow("REDIRECT /login");
  cookie = "wrong";
  await expect(postNoteAction("backups", null, form())).rejects.toThrow("REDIRECT /login");
  expect(await written()).toEqual([]);
  cookie = sessionFor("pw", "test");
  await expect(postNoteAction("backups", null, form())).rejects.toThrow(/^REDIRECT \/backups\?posted=/);
});

test("rate limit applies", async () => {
  process.env.NOTEFEED_RATE_LIMIT = "1";
  await expect(postNoteAction("backups", null, form())).rejects.toThrow(/^REDIRECT/);
  expect(await postNoteAction("backups", null, form())).toMatch(/^Too many notes, try again in \d+ seconds\.$/);
  expect(await readdir(join(dir, "backups"))).toHaveLength(1);
});

test("caps apply", async () => {
  process.env.NOTEFEED_MAX_FEEDS = "1";
  process.env.NOTEFEED_MAX_NOTES_PER_FEED = "1";
  await expect(postNoteAction("a", null, form())).rejects.toThrow(/^REDIRECT/);
  expect(await postNoteAction("b", null, form())).toBe("This instance has reached its feed limit.");
  expect(await postNoteAction("a", null, form("# Two"))).toBe("This feed has reached its note limit.");
  expect(await written()).toEqual(["a"]);
});

test("empty note", async () => {
  expect(await postNoteAction("backups", null, form("  "))).toBe("The note is empty.");
});

const login = (password: string, next?: string) => {
  const f = new FormData();
  f.set("password", password);
  if (next !== undefined) f.set("next", next);
  return loginAction(null, f);
};

test("login returns to the page in next", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  await expect(login("pw", "/backups?x=1")).rejects.toThrow("REDIRECT /backups?x=1");
});

test.each([undefined, "//evil.example", "https://evil.example", "/\\evil.example"])("login with next=%j lands on /", async (next) => {
  process.env.NOTEFEED_PASSWORD = "pw";
  await expect(login("pw", next)).rejects.toThrow(/^REDIRECT \/$/);
});

test("a wrong password stays on the login page", async () => {
  process.env.NOTEFEED_PASSWORD = "pw";
  expect(await login("nope", "/backups")).toMatch(/doesn't match/);
});
