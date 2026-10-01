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

// The markdown the CLI posted (the client sends JSON {markdown}).
const sent = (i: number) => JSON.parse(server.requests[i].body.toString()).markdown;

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
  expect(sent(0)).toBe("hi");
});

test("postStdin", async () => {
  const t = io("# from stdin\r\nCafé\n");
  expect(await main(["post", "-", "--url", server.url, "--feed", "inbox"], t.io)).toBe(0);
  expect(sent(0)).toBe("# from stdin\r\nCafé\n");
});

test("postFile", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "nf-")), "note.md");
  writeFileSync(f, "# File\r\nbody\n");
  expect(await main(["post", "--file", f, "--url", server.url, "--feed", "inbox"], io().io)).toBe(0);
  expect(sent(0)).toBe("# File\r\nbody\n");
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
  expect(sent(0)).toBe("- buy milk");
});

test("help", async () => {
  const t = io();
  expect(await main(["post", "--help"], t.io)).toBe(0);
  expect(t.out.stdout).toContain("usage: notefeed post");
});

test("explicitDoubleDashStillWorks", async () => {
  expect(await main(["post", "--url", server.url, "--feed", "inbox", "--", "- buy milk"], io().io)).toBe(0);
  expect(sent(0)).toBe("- buy milk");
});

test("envVars", async () => {
  process.env.NOTEFEED_URL = server.url;
  process.env.NOTEFEED_FEED = "envfeed";
  process.env.NOTEFEED_PASSWORD = "envpw";
  expect(await main(["post", "- buy milk"], io().io)).toBe(0);
  expect(server.requests[0].path).toBe("/api/v1/feeds/envfeed/notes");
  expect(server.requests[0].headers.authorization).toBe("Bearer envpw");
  expect(sent(0)).toBe("- buy milk");
});

test("flagsWinOverEnv", async () => {
  process.env.NOTEFEED_URL = "http://127.0.0.1:1";
  process.env.NOTEFEED_FEED = "envfeed";
  process.env.NOTEFEED_PASSWORD = "envpw";
  expect(await main(["post", "hi", "--url", server.url, "--feed", "argfeed", "--password", "argpw"], io().io)).toBe(0);
  expect(server.requests[0].path).toBe("/api/v1/feeds/argfeed/notes");
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

// notefeed notes: a feed of `count` notes, served a page at a time like the server.
function serveNotes(count: number) {
  const notes = Array.from({ length: count }, (_, i) => ({
    id: `20260930T10${String(i).padStart(2, "0")}00Z-n${i}`,
    title: `Note ${i}`,
    markdown: `# Note ${i}`,
    created_at: `2026-09-30T10:${String(i).padStart(2, "0")}:00.000Z`,
    url: `https://n.example/inbox/n${i}`,
  })).reverse();
  server.route((r) => {
    const q = new URL(r.path, "http://x").searchParams;
    const limit = Number(q.get("limit") ?? 50);
    const older = notes.filter((n) => !q.get("before") || n.id < q.get("before")!);
    return [200, { notes: older.slice(0, limit), next: older.length > limit ? older[limit - 1].id : null }];
  });
}
const args = (...a: string[]) => ["notes", "--url", server.url, "--feed", "inbox", ...a];

test("notesPrintsNewestWithLimit", async () => {
  serveNotes(5);
  const { out, io: x } = io();
  expect(await main(args("--limit", "3"), x)).toBe(0);
  expect(out.stdout).toBe(
    [
      "2026-09-30T10:04:00Z  Note 4  https://n.example/inbox/n4",
      "2026-09-30T10:03:00Z  Note 3  https://n.example/inbox/n3",
      "2026-09-30T10:02:00Z  Note 2  https://n.example/inbox/n2",
      "",
    ].join("\n"),
  );
});

test("notesDefaultsToTwentyAcrossPages", async () => {
  serveNotes(30);
  const { out, io: x } = io();
  expect(await main(args(), x)).toBe(0);
  expect(out.stdout.trim().split("\n")).toHaveLength(20);
});

test("notesJson", async () => {
  serveNotes(2);
  const { out, io: x } = io();
  expect(await main(args("--json"), x)).toBe(0);
  expect(out.stdout.trim().split("\n").map((l) => JSON.parse(l).title)).toEqual(["Note 1", "Note 0"]);
  expect(JSON.parse(out.stdout.split("\n")[0]).created_at).toBe("2026-09-30T10:01:00Z");
});

test("notesWithoutFeedIsUsageError", async () => {
  const { out, io: x } = io();
  expect(await main(["notes", "--url", server.url], x)).toBe(2);
  expect(out.stderr).toMatch(/no feed given/);
});

test("notesAuthErrorExitsOne", async () => {
  server.route(() => [401, { error: "missing or wrong password", code: "auth" }]);
  const { out, io: x } = io();
  expect(await main(args(), x)).toBe(1);
  expect(out.stderr).toBe("notefeed: missing or wrong password\n");
});

test("notesRejectsBadLimit", async () => {
  const { io: x } = io();
  expect(await main(args("--limit", "0"), x)).toBe(2);
});
