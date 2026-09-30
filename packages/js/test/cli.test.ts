import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, test } from "vitest";
import { main } from "../src/cli.js";
import { fakeServer } from "./server.js";

let server: Awaited<ReturnType<typeof fakeServer>>;
beforeEach(async () => {
  delete process.env.NOTEFEED_URL;
  delete process.env.NOTEFEED_FEED;
  delete process.env.NOTEFEED_PASSWORD;
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
  server.reply(201, { id: "i", url: "https://n.example/inbox/i", read_url: "https://n.example/r/x/feed.xml" });
  const t = io();
  expect(await main(["post", "hi", "--url", server.url, "--feed", "inbox"], t.io)).toBe(0);
  expect(t.out.stdout.trim()).toBe("https://n.example/inbox/i");
  expect(server.requests[0].body.toString()).toBe("hi");
});

test("postStdin", async () => {
  const t = io("# from stdin\r\nCafé\n");
  expect(await main(["post", "-", "--url", server.url, "--feed", "inbox"], t.io)).toBe(0);
  expect(server.requests[0].body.equals(Buffer.from("# from stdin\r\nCafé\n", "utf8"))).toBe(true);
});

test("postFile", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "nf-")), "note.md");
  writeFileSync(f, "# File\r\nbody\n");
  expect(await main(["post", "--file", f, "--url", server.url, "--feed", "inbox"], io().io)).toBe(0);
  expect(server.requests[0].body.toString()).toBe("# File\r\nbody\n");
});

test("missingFileExits2", async () => {
  const t = io();
  expect(await main(["post", "--file", "/nonexistent/nope.md", "--url", "http://x", "--feed", "inbox"], t.io)).toBe(2);
  expect(t.out.stderr.startsWith("notefeed: ")).toBe(true);
});

test("noTextExits2WithoutReadingStdin", async () => {
  const t = io();
  expect(await main(["post", "--url", "http://x", "--feed", "inbox"], t.io)).toBe(2);
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
  server.reply(401, { error: "missing or wrong password" });
  const t = io();
  expect(await main(["post", "hi", "--url", server.url, "--feed", "inbox", "--password", "bad"], t.io)).toBe(1);
  expect(t.out.stderr.trim()).toBe("notefeed: missing or wrong password");
});

test("connectionRefusedExits1OneLine", async () => {
  const t = io();
  expect(await main(["post", "hi", "--url", "http://127.0.0.1:1", "--feed", "inbox"], t.io)).toBe(1);
  expect(t.out.stderr.startsWith("notefeed: ")).toBe(true);
  expect(t.out.stderr.split("\n").length).toBe(2);
});

test("version", async () => {
  const t = io();
  expect(await main(["--version"], t.io)).toBe(0);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(t.out.stdout.trim()).toBe(`notefeed ${pkg.version}`);
});

test("fileNotUtf8Exits2", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "nf-")), "latin1.md");
  writeFileSync(f, Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0a]));
  const t = io();
  expect(await main(["post", "--file", f, "--url", server.url, "--feed", "inbox"], t.io)).toBe(2);
  expect(t.out.stderr).toContain("not UTF-8");
  expect(server.requests).toEqual([]);
});

test("stdinNotUtf8Exits2", async () => {
  const t = io();
  t.io.stdin = Readable.from([Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0a])]);
  expect(await main(["post", "-", "--url", server.url, "--feed", "inbox"], t.io)).toBe(2);
  expect(t.out.stderr).toContain("not UTF-8");
  expect(server.requests).toEqual([]);
});

test("listItemText", async () => {
  expect(await main(["post", "- buy milk", "--url", server.url, "--feed", "inbox"], io().io)).toBe(0);
  expect(server.requests[0].body.toString()).toBe("- buy milk");
});

test("help", async () => {
  const t = io();
  expect(await main(["post", "--help"], t.io)).toBe(0);
  expect(t.out.stdout).toContain("usage: notefeed post");
});

test("explicitDoubleDashStillWorks", async () => {
  expect(await main(["post", "--url", server.url, "--feed", "inbox", "--", "- buy milk"], io().io)).toBe(0);
  expect(server.requests[0].body.toString()).toBe("- buy milk");
});

test("envVars", async () => {
  process.env.NOTEFEED_URL = server.url;
  process.env.NOTEFEED_FEED = "envfeed";
  process.env.NOTEFEED_PASSWORD = "envpw";
  expect(await main(["post", "- buy milk"], io().io)).toBe(0);
  expect(server.requests[0].path).toBe("/envfeed");
  expect(server.requests[0].headers.authorization).toBe("Bearer envpw");
  expect(server.requests[0].body.toString()).toBe("- buy milk");
});

test("flagsWinOverEnv", async () => {
  process.env.NOTEFEED_URL = "http://127.0.0.1:1";
  process.env.NOTEFEED_FEED = "envfeed";
  process.env.NOTEFEED_PASSWORD = "envpw";
  expect(await main(["post", "hi", "--url", server.url, "--feed", "argfeed", "--password", "argpw"], io().io)).toBe(0);
  expect(server.requests[0].path).toBe("/argfeed");
  expect(server.requests[0].headers.authorization).toBe("Bearer argpw");
});

test("noPasswordSendsNoAuth", async () => {
  expect(await main(["post", "hi", "--url", server.url, "--feed", "inbox"], io().io)).toBe(0);
  expect(server.requests[0].headers.authorization).toBeUndefined();
});

test("noFeedExits2NamingFlagAndEnv", async () => {
  const t = io();
  expect(await main(["post", "hi", "--url", server.url], t.io)).toBe(2);
  expect(t.out.stderr).toContain("--feed");
  expect(t.out.stderr).toContain("NOTEFEED_FEED");
  expect(server.requests).toEqual([]);
});

test("invalidFeedExits2", async () => {
  const t = io();
  expect(await main(["post", "hi", "--url", server.url, "--feed", "Not/Valid"], t.io)).toBe(2);
  expect(t.out.stderr).toContain("invalid feed name");
  expect(server.requests).toEqual([]);
});
