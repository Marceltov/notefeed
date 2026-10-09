import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { SERVER_LOG as LOG } from "./serverlog";

const feedName = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type Line = Record<string, unknown>;
const lines = async (): Promise<Line[]> =>
  (await readFile(LOG, "utf8")).split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Line);

test("a request through Next gets its line, with the handler's route and outcome and the id its other lines carry", async ({ request, page }) => {
  const name = feedName();
  // An image as the feed's first note: only this test makes a feed with one, so its lines can be told from the other tests'.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  expect((await request.post(`/${name}`, { data: png, headers: { "content-type": "image/png" } })).status()).toBe(201);
  await page.goto(`/${name}`);
  expect((await request.put(`/api/v1/feeds/${name}/notes/nope`, { data: "x", headers: { "content-type": "text/markdown" } })).status()).toBe(404);

  await expect(async () => {
    const all = await lines();
    const posted = all.filter((l) => l.msg === "note posted" && l.kind === "image" && l.bytes === png.length);
    // The post came by /<feed>: the dispatcher named the operation, and the feed and the note were logged inside the same request.
    const mine = posted.map((p) => all.filter((l) => l.req === p.req)).find((group) => group.some((l) => l.msg === "feed created"));
    expect(mine?.find((l) => l.msg === "request")).toMatchObject({ component: "http", method: "POST", route: "/api/v1/feeds/[feed]/notes", status: 201 });
    expect(all.some((l) => l.msg === "request" && l.method === "GET" && l.route === "/[feed]" && l.status === 200)).toBe(true);
    expect(all.some((l) => l.msg === "request" && l.method === "PUT" && l.route === "/api/v1/feeds/[feed]/notes/[id]" && l.status === 404 && l.outcome === "not_found")).toBe(true);
  }).toPass({ timeout: 5000 });

  // The path was in three requests, the feed's name in none of the lines.
  expect(await readFile(LOG, "utf8")).not.toContain(name);
});
