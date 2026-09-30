import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, test } from "vitest";
import { main } from "../src/cli.js";
import { fakeServer } from "./server.js";

let server: Awaited<ReturnType<typeof fakeServer>>;
beforeEach(async () => {
  delete process.env.NOTEFEED_URL;
  delete process.env.NOTEFEED_TOKEN;
  server = await fakeServer();
});
afterEach(() => server.close());

function io(stdin = "") {
  const out = { stdout: "", stderr: "" };
  return {
    out,
    io: {
      stdin: Readable.from([Buffer.from(stdin, "utf8")]),
      stdout: { write: (s: string) => ((out.stdout += s), true) },
      stderr: { write: (s: string) => ((out.stderr += s), true) },
    },
  };
}

test("postTextPrintsUrl", async () => {
  server.reply(201, { id: "i", url: "https://n.example/n/i" });
  const t = io();
  expect(await main(["post", "hi", "--url", server.url, "--token", "t"], t.io)).toBe(0);
  expect(t.out.stdout.trim()).toBe("https://n.example/n/i");
  expect(server.requests[0].body.toString()).toBe("hi");
});

test("postStdin", async () => {
  const t = io("# from stdin\r\nCafé\n");
  expect(await main(["post", "-", "--url", server.url, "--token", "t"], t.io)).toBe(0);
  expect(server.requests[0].body.equals(Buffer.from("# from stdin\r\nCafé\n", "utf8"))).toBe(true);
});

test("postFile", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "nf-")), "note.md");
  writeFileSync(f, "# File\r\nbody\n");
  expect(await main(["post", "--file", f, "--url", server.url, "--token", "t"], io().io)).toBe(0);
  expect(server.requests[0].body.toString()).toBe("# File\r\nbody\n");
});

test("missingFileExits2", async () => {
  const t = io();
  expect(await main(["post", "--file", "/nonexistent/nope.md", "--url", "http://x", "--token", "t"], t.io)).toBe(2);
  expect(t.out.stderr.startsWith("notefeed: ")).toBe(true);
});

test("noTextExits2WithoutReadingStdin", async () => {
  const t = io();
  expect(await main(["post", "--url", "http://x", "--token", "t"], t.io)).toBe(2);
  expect(t.out.stderr).toContain("notefeed: ");
});

test("noConfigExits2", async () => {
  const t = io();
  expect(await main(["post", "hi"], t.io)).toBe(2);
  expect(t.out.stderr).toContain("NOTEFEED_URL");
});

test("unknownOptionExits2", async () => {
  const t = io();
  expect(await main(["post", "hi", "--nope"], t.io)).toBe(2);
  expect(t.out.stderr.startsWith("notefeed: ")).toBe(true);
});

test("serverErrorExits1", async () => {
  server.reply(401, { error: "missing or wrong bearer token" });
  const t = io();
  expect(await main(["post", "hi", "--url", server.url, "--token", "bad"], t.io)).toBe(1);
  expect(t.out.stderr.trim()).toBe("notefeed: missing or wrong bearer token");
});

test("connectionRefusedExits1OneLine", async () => {
  const t = io();
  expect(await main(["post", "hi", "--url", "http://127.0.0.1:1", "--token", "t"], t.io)).toBe(1);
  expect(t.out.stderr.startsWith("notefeed: ")).toBe(true);
  expect(t.out.stderr.split("\n").length).toBe(2);
});

test("version", async () => {
  const t = io();
  expect(await main(["--version"], t.io)).toBe(0);
  expect(t.out.stdout.trim()).toBe("notefeed 0.1.0");
});
