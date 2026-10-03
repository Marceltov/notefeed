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
  delete process.env.NOTEFEED_FEED_PASSWORD;
  server = await fakeServer();
});
afterEach(() => server.close());

// What the CLI sent: the body is the file itself, its Content-Type the type.
const sent = (i: number) => server.requests[i].body.toString();
const typeOf = (i: number) => server.requests[i].headers["content-type"];

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

test("feedPasswordFromEnv", async () => {
  process.env.NOTEFEED_FEED_PASSWORD = "fp";
  expect(await main(["post", "hi", "--url", server.url, "--feed", "inbox"], io().io)).toBe(0);
  expect(server.requests[0].headers["x-feed-password"]).toBe("fp");
  server.reply(200, { notes: [], next: null });
  expect(await main(["notes", "--url", server.url, "--feed", "inbox"], io().io)).toBe(0);
  expect(server.requests[1].headers["x-feed-password"]).toBe("fp");
});

test("noFeedPasswordSendsNoHeader", async () => {
  expect(await main(["post", "hi", "--url", server.url, "--feed", "inbox"], io().io)).toBe(0);
  expect(server.requests[0].headers["x-feed-password"]).toBeUndefined();
});

test("feedExistsExits1", async () => {
  server.reply(409, { error: "feed exists", code: "feed_exists" });
  const t = io();
  expect(await main(["post", "hi", "--url", server.url, "--feed", "inbox"], t.io)).toBe(1);
  expect(t.out.stderr).toBe("notefeed: feed exists\n");
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

test("notesJsonPrintsExactlyTheDocumentedFields", async () => {
  server.route(() => [
    200,
    { notes: [{ id: "20260930T100000Z-a", type: "text/markdown", title: "A", content: "# A", file: "a.md", file_url: null, size: 3, tags: ["x"], created_at: "2026-09-30T10:00:00.000Z", url: "https://n/a", mood: "new" }], next: null },
  ]);
  const { out, io: x } = io();
  expect(await main(args("--json"), x)).toBe(0);
  expect(Object.keys(JSON.parse(out.stdout))).toEqual(["id", "type", "title", "content", "file", "file_url", "size", "tags", "created_at", "url"]);
});

const NOTE = { id: "i", type: "text/markdown", title: "T", content: "x", file: "i.md", file_url: "https://n.example/r/X/i.md", size: 1, tags: [], created_at: "2026-09-30T10:00:00.000Z", url: "https://n.example/inbox/i" };
const CREATED_REPLY = { id: "i", url: "https://n.example/inbox/i", feed_url: "https://n.example/inbox", read_url: "https://n.example/r/x/feed.xml", file: "i.md", file_url: "https://n.example/r/x/i.md" };

test("editTextPrintsUrl", async () => {
  server.reply(200, NOTE);
  const t = io();
  expect(await main(["edit", "i", "new", "--url", server.url, "--feed", "inbox"], t.io)).toBe(0);
  expect(t.out.stdout).toBe("https://n.example/inbox/i\n");
  expect([server.requests[0].method, server.requests[0].path]).toEqual(["PUT", "/api/v1/feeds/inbox/notes/i"]);
  expect(sent(0)).toBe("new");
});

test("editStdinAndFile", async () => {
  expect(await main(["edit", "i", "-", "--url", server.url, "--feed", "inbox"], io("from stdin").io)).toBe(0);
  expect(sent(0)).toBe("from stdin");
  const f = join(mkdtempSync(join(tmpdir(), "nf-")), "n.md");
  writeFileSync(f, "from file");
  expect(await main(["edit", "i", "--file", f, "--url", server.url, "--feed", "inbox"], io().io)).toBe(0);
  expect(sent(1)).toBe("from file");
});

test("editNeedsAnIdAndText", async () => {
  expect(await main(["edit", "--url", "http://x", "--feed", "inbox"], io().io)).toBe(2);
  expect(await main(["edit", "i", "--url", "http://x", "--feed", "inbox"], io().io)).toBe(2);
});

test("deletePrintsNothingAndSendsFeedPassword", async () => {
  process.env.NOTEFEED_FEED_PASSWORD = "fp";
  server.reply(204, "", "text/plain");
  const t = io();
  expect(await main(["delete", "i", "--url", server.url, "--feed", "inbox", "--password", "pw"], t.io)).toBe(0);
  expect(t.out).toEqual({ stdout: "", stderr: "" });
  const r = server.requests[0];
  expect([r.method, r.path, r.headers["x-feed-password"], r.headers.authorization]).toEqual(["DELETE", "/api/v1/feeds/inbox/notes/i", "fp", "Bearer pw"]);
});

test("deleteErrors", async () => {
  server.reply(404, { error: "no such note", code: "not_found" });
  const t = io();
  expect(await main(["delete", "i", "--url", server.url, "--feed", "inbox"], t.io)).toBe(1);
  expect(t.out.stderr).toBe("notefeed: no such note\n");
  expect(await main(["delete", "--url", server.url, "--feed", "inbox"], io().io)).toBe(2);
  expect(await main(["delete", "i", "--url", server.url], io().io)).toBe(2);
});

test("postDeclaresMarkdownForTextAndFiles", async () => {
  server.reply(201, CREATED_REPLY);
  await main(["post", "hi", "--url", server.url, "--feed", "inbox"], io().io);
  expect(typeOf(0)).toBe("text/markdown");
  const f = join(mkdtempSync(join(tmpdir(), "nf-")), "note.md");
  writeFileSync(f, "# File\n");
  await main(["post", "--file", f, "--url", server.url, "--feed", "inbox"], io().io);
  expect(typeOf(1)).toBe("text/markdown");
});

test("postPictureFileSendsItsBytesAsItsType", async () => {
  server.reply(201, CREATED_REPLY);
  const f = join(mkdtempSync(join(tmpdir(), "nf-")), "Photo.PNG");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255]);
  writeFileSync(f, png);
  const t = io();
  expect(await main(["post", "--file", f, "--title", "Café", "--tag", "pets", "--url", server.url, "--feed", "inbox"], t.io)).toBe(0);
  expect(t.out.stdout.trim()).toBe(CREATED_REPLY.url);
  expect(typeOf(0)).toBe("image/png");
  expect([...server.requests[0].body]).toEqual([...png]);
  expect(Buffer.from(String(server.requests[0].headers["x-note-title"]), "latin1").toString("utf8")).toBe("Café");
  expect(server.requests[0].headers["x-note-tags"]).toBe("pets");
  expect(server.requests[0].headers["x-note-name"]).toBe("Photo.PNG");
});

test("postTypeFlagWinsAndAnUnknownExtensionNeedsIt", async () => {
  server.reply(201, CREATED_REPLY);
  const dir = mkdtempSync(join(tmpdir(), "nf-"));
  const f = join(dir, "data.bin");
  writeFileSync(f, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]));
  const t = io();
  expect(await main(["post", "--file", f, "--url", server.url, "--feed", "inbox"], t.io)).toBe(2);
  expect(t.out.stderr).toContain("--type");
  expect(await main(["post", "--file", f, "--type", "image/jpeg", "--url", server.url, "--feed", "inbox"], io().io)).toBe(0);
  expect(typeOf(0)).toBe("image/jpeg");
});

test("postRefusedTypeExitsLikeAnyError", async () => {
  server.reply(415, { error: "send a Content-Type of text/markdown, image/png", code: "unsupported_type" });
  const f = join(mkdtempSync(join(tmpdir(), "nf-")), "x.png");
  writeFileSync(f, "not a png");
  const u = io();
  expect(await main(["post", "--file", f, "--url", server.url, "--feed", "inbox"], u.io)).toBe(1);
  expect(u.out.stderr).toBe("notefeed: send a Content-Type of text/markdown, image/png\n");
});

test("updateSetsTitleAndAlt", async () => {
  server.reply(200, { ...NOTE, url: "https://n.example/inbox/i" });
  const t = io();
  expect(await main(["update", "i", "--title", "T", "--alt", "A", "--url", server.url, "--feed", "inbox"], t.io)).toBe(0);
  expect([server.requests[0].method, server.requests[0].path]).toEqual(["PATCH", "/api/v1/feeds/inbox/notes/i"]);
  expect(JSON.parse(sent(0))).toEqual({ title: "T", alt: "A" });
  expect(await main(["update", "i", "--url", server.url, "--feed", "inbox"], io().io)).toBe(2); // nothing to change
});

test("editSendsThePictureOfItsType", async () => {
  server.reply(200, NOTE);
  const f = join(mkdtempSync(join(tmpdir(), "nf-")), "x.webp");
  writeFileSync(f, "RIFF....WEBPVP8 ");
  expect(await main(["edit", "i", "--file", f, "--url", server.url, "--feed", "inbox"], io().io)).toBe(0);
  expect([server.requests[0].method, typeOf(0)]).toEqual(["PUT", "image/webp"]);
});

// --attach: pictures and text in one multipart request.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
function pics() {
  const dir = mkdtempSync(join(tmpdir(), "nf-attach-"));
  writeFileSync(join(dir, "chart.png"), PNG);
  writeFileSync(join(dir, "t.webp"), PNG);
  writeFileSync(join(dir, "notes.md"), "# x");
  return dir;
}
const created = (id: string, file: string) => ({ id, url: `https://n.example/inbox/${id}`, feed_url: "f", read_url: null, file, file_url: "x" });
const parse = (i: number) => new Response(new Uint8Array(server.requests[i].body), { headers: { "content-type": typeOf(i)! } }).formData();

test("postAttachSendsOneMultipartRequestAndPrintsTheTextUrlThenTheImageUrls", async () => {
  server.reply(201, { ...created("T", "T.md"), attachments: [created("I1", "F1.png"), created("I2", "F2.webp")] });
  const dir = pics();
  const t = io();
  expect(await main(["post", "see ![](chart.png)", "--attach", join(dir, "chart.png"), "--attach", join(dir, "t.webp"), "--url", server.url, "--feed", "inbox"], t.io)).toBe(0);
  expect(t.out.stdout.trim().split("\n")).toEqual(["https://n.example/inbox/T", "https://n.example/inbox/I1", "https://n.example/inbox/I2"]);
  expect(server.requests).toHaveLength(1);
  expect(typeOf(0)).toMatch(/^multipart\/form-data; boundary=/);
  const form = await parse(0);
  expect(await (form.get("text") as File).text()).toBe("see ![](chart.png)");
  expect((form.getAll("file") as File[]).map((f) => [f.name, f.type])).toEqual([["chart.png", "image/png"], ["t.webp", "image/webp"]]);
});

test("postAttachWithoutTextSendsNoTextPartAndPrintsEachPictureUrlOnce", async () => {
  server.reply(201, { ...created("I1", "F1.png"), attachments: [created("I1", "F1.png"), created("I2", "F2.png")] });
  const dir = pics();
  const t = io();
  expect(await main(["post", "--attach", join(dir, "chart.png"), "--attach", join(dir, "chart.png").replace("chart", "t").replace(".png", ".webp"), "--url", server.url, "--feed", "inbox"], t.io)).toBe(0);
  expect(t.out.stdout.trim().split("\n")).toEqual(["https://n.example/inbox/I1", "https://n.example/inbox/I2"]);
  const form = await parse(0);
  expect(form.has("text")).toBe(false);
  expect(form.getAll("file")).toHaveLength(2);
});

test.each([
  ["an unreadable attachment", () => "/nonexistent/x.png"],
  ["a markdown attachment", () => join(pics(), "notes.md")],
  ["an unknown extension", () => join(pics(), "chart.png").replace(".png", ".xyz")],
])("postAttach: %s exits 2 and posts nothing", async (_, path) => {
  const t = io();
  expect(await main(["post", "hi", "--attach", path(), "--url", server.url, "--feed", "inbox"], t.io)).toBe(2);
  expect(server.requests).toHaveLength(0);
});

test("postAttachRefusedExits1NamingTheAttachmentAndPrintsNothing", async () => {
  server.reply(400, { error: 'attachment "t.webp": bad image', code: "invalid_body" });
  const dir = pics();
  const t = io();
  expect(await main(["post", "hi", "--attach", join(dir, "chart.png"), "--attach", join(dir, "t.webp"), "--url", server.url, "--feed", "inbox"], t.io)).toBe(1);
  expect(t.out.stdout).toBe("");
  expect(t.out.stderr).toBe('notefeed: attachment "t.webp": bad image\n');
  expect(server.requests).toHaveLength(1);
});

test("usageListsAttach", async () => {
  const t = io();
  expect(await main(["--help"], t.io)).toBe(0);
  expect(t.out.stdout).toContain("[--attach PATH]...");
});

test("postAttachNameWithASpaceIsAcceptedAndSentWithThatFilename", async () => {
  server.reply(201, { ...created("T", "T.md"), attachments: [created("I1", "F1.png")] });
  const dir = pics();
  writeFileSync(join(dir, "my chart.png"), PNG);
  const t = io();
  expect(await main(["post", "hi", "--attach", join(dir, "my chart.png"), "--url", server.url, "--feed", "inbox"], t.io)).toBe(0);
  expect(((await parse(0)).get("file") as File).name).toBe("my chart.png");
});

test("postAttachWithANonMarkdownFileExits2AndPostsNothing", async () => {
  const dir = pics();
  const t = io();
  expect(await main(["post", "--file", join(dir, "chart.png"), "--attach", join(dir, "t.webp"), "--url", server.url, "--feed", "inbox"], t.io)).toBe(2);
  expect(server.requests).toHaveLength(0);
});
