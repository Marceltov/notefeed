import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { fakeServer } from "./server.js";

// Runs the built CLI (npm run build first, as CI does) through a real pipe.
const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

let server: Awaited<ReturnType<typeof fakeServer>>;
beforeEach(async () => {
  server = await fakeServer();
});
afterEach(() => server.close());

test("notefeed notes | head -1: stops quietly when the reader goes away", async () => {
  const notes = Array.from({ length: 60 }, (_, i) => ({
    id: `20260930T10${String(i).padStart(2, "0")}00Z-n${i}`,
    title: `Note ${i}`,
    markdown: "# x".repeat(2000),
    created_at: `2026-09-30T10:${String(i).padStart(2, "0")}:00.000Z`,
    url: `https://n/${i}`,
  }));
  server.route(() => [200, { notes, next: null }]);
  const child = spawn(process.execPath, [BIN, "notes", "--json", "--limit", "60", "--url", server.url, "--feed", "inbox"]);
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.once("data", () => child.stdout.destroy()); // like `head -1`: read, then close the pipe
  const code = await new Promise((r) => child.on("close", r));
  expect(stderr).toBe("");
  expect(code).toBe(0);
});
