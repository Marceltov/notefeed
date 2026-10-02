import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { cookieValue, createProtected, feedCookieName } from "../feedlock";
import { hasFeed, resetFeedsForTests } from "../feeds";
import { getSettings } from "../feedsettings";
import { resetRateLimitsForTests } from "../limits";
import { createNote } from "../notes";
import { feedDeleteRoute, feedSettingsRoute } from "./feedforms";

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-ff-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  delete process.env.NOTEFEED_RATE_LIMIT;
  resetFeedsForTests();
  resetRateLimitsForTests();
  await createNote("openfeed", "# Old");
});

const send = (route: typeof feedSettingsRoute, feed: string, fields: Record<string, string>, origin: string | null = "http://localhost:3000", cookie?: string) => {
  const body = new URLSearchParams(fields);
  return route(
    new Request(`http://localhost:3000/${feed}/x`, {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) },
      body,
    }),
    feed,
  );
};
const loc = (r: Response) => r.headers.get("location");

test("settings are saved and the feed page says so", async () => {
  const res = await send(feedSettingsRoute, "openfeed", { title: " Ideas ", description: "Things" });
  expect(res.status).toBe(303);
  expect(loc(res)).toBe("/openfeed/settings?saved=1");
  expect(await getSettings("openfeed")).toEqual({ title: "Ideas", description: "Things", image: "", showSender: true });
});

test("an invalid title goes back with the code", async () => {
  expect(loc(await send(feedSettingsRoute, "openfeed", { title: "x".repeat(101), description: "" }))).toBe("/openfeed/settings?form=details&error=invalid_body");
});

test("a feed that doesn't exist cannot get settings", async () => {
  expect(loc(await send(feedSettingsRoute, "nofeed", { title: "T", description: "" }))).toBe("/nofeed/settings?form=details&error=not_found");
});

test("delete needs the exact name and removes the feed", async () => {
  expect(loc(await send(feedDeleteRoute, "openfeed", { confirm: "openfee" }))).toBe("/openfeed/settings?form=details&error=invalid_request");
  expect(loc(await send(feedDeleteRoute, "openfeed", {}))).toBe("/openfeed/settings?form=details&error=invalid_request");
  expect(await hasFeed("openfeed")).toBe(true);
  expect(loc(await send(feedDeleteRoute, "openfeed", { confirm: "openfeed" }))).toBe("/?deleted=openfeed");
  expect(await hasFeed("openfeed")).toBe(false);
});

test("deleting a feed that is already gone still lands on the notice (a double click)", async () => {
  await send(feedDeleteRoute, "openfeed", { confirm: "openfeed" });
  expect(loc(await send(feedDeleteRoute, "openfeed", { confirm: "openfeed" }))).toBe("/?deleted=openfeed");
});

test.each([["another site", "https://evil.example"], ["no Origin", null]])("from %s: refused, nothing changed", async (_, origin) => {
  expect(loc(await send(feedSettingsRoute, "openfeed", { title: "Hacked", description: "" }, origin))).toBe("/openfeed/settings?form=details&error=auth");
  expect(loc(await send(feedDeleteRoute, "openfeed", { confirm: "openfeed" }, origin))).toBe("/openfeed/settings?form=details&error=auth");
  expect(await getSettings("openfeed")).toEqual({ title: "", description: "", image: "", showSender: true });
  expect(await hasFeed("openfeed")).toBe(true);
});

test("a protected feed needs its cookie; deleting it clears the cookies", async () => {
  await createProtected("lockd", "pw");
  await createNote("lockd", "# Old");
  expect(loc(await send(feedSettingsRoute, "lockd", { title: "T", description: "" }))).toBe("/lockd/settings?form=details&error=auth");
  expect(loc(await send(feedDeleteRoute, "lockd", { confirm: "lockd" }))).toBe("/lockd/settings?form=details&error=auth");
  const cookie = `${feedCookieName("lockd")}=${await cookieValue("lockd")}`;
  expect(loc(await send(feedSettingsRoute, "lockd", { title: "T", description: "" }, "http://localhost:3000", cookie))).toBe("/lockd/settings?saved=1");
  const res = await send(feedDeleteRoute, "lockd", { confirm: "lockd" }, "http://localhost:3000", cookie);
  expect(loc(res)).toBe("/?deleted=lockd");
  const cleared = res.headers.getSetCookie();
  expect(cleared).toHaveLength(2);
  expect(cleared.every((c) => c.includes("Max-Age=0"))).toBe(true);
});

test("an invalid feed name is a 400", async () => {
  expect((await send(feedSettingsRoute, "a%2Fb", { title: "T", description: "" })).status).toBe(400);
  expect((await send(feedDeleteRoute, "a%2Fb", { confirm: "a%2Fb" })).status).toBe(400);
});

test("show_sender: the checkbox counts only when its marker is sent", async () => {
  const base = { title: "T", description: "" };
  await send(feedSettingsRoute, "openfeed", { ...base, show_sender_present: "1" });
  expect((await getSettings("openfeed")).showSender).toBe(false);
  await send(feedSettingsRoute, "openfeed", base);
  expect((await getSettings("openfeed")).showSender).toBe(false);
  await send(feedSettingsRoute, "openfeed", { ...base, show_sender_present: "1", show_sender: "on" });
  expect((await getSettings("openfeed")).showSender).toBe(true);
  await send(feedSettingsRoute, "openfeed", base);
  expect((await getSettings("openfeed")).showSender).toBe(true);
});
