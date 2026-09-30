import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AuthError, Client, ConfigError, InvalidNoteError, NotefeedError, NoteTooLargeError, post } from "../src/index.js";
import { fakeServer } from "./server.js";

let server: Awaited<ReturnType<typeof fakeServer>>;
beforeEach(async () => {
  delete process.env.NOTEFEED_URL;
  delete process.env.NOTEFEED_TOKEN;
  server = await fakeServer();
});
afterEach(() => server.close());

test("postSendsMarkdownAndReturnsNote", async () => {
  server.reply(201, { id: "20260930T100000Z-cafe", url: "https://n.example/n/20260930T100000Z-cafe" });
  const note = await new Client({ url: server.url, token: "t" }).post("# Café\r\nx");
  expect(note).toEqual({ id: "20260930T100000Z-cafe", url: "https://n.example/n/20260930T100000Z-cafe" });
  const req = server.requests[0];
  expect(req.method).toBe("POST");
  expect(req.path).toBe("/api/notes");
  expect(req.headers.authorization).toBe("Bearer t");
  expect(req.headers["content-type"]).toBe("text/markdown; charset=utf-8");
  expect(req.body.equals(Buffer.from("# Café\r\nx", "utf8"))).toBe(true);
});

test("trailingSlashAndSubpath", async () => {
  await new Client({ url: server.url + "/sub/", token: "t" }).post("x");
  expect(server.requests[0].path).toBe("/sub/api/notes");
});

test("envConfig", async () => {
  process.env.NOTEFEED_URL = server.url;
  process.env.NOTEFEED_TOKEN = "envtok";
  await new Client().post("x");
  expect(server.requests[0].headers.authorization).toBe("Bearer envtok");
});

test("explicitArgsWin", async () => {
  process.env.NOTEFEED_URL = "http://127.0.0.1:1";
  process.env.NOTEFEED_TOKEN = "envtok";
  await new Client({ url: server.url, token: "argtok" }).post("x");
  expect(server.requests[0].headers.authorization).toBe("Bearer argtok");
});

test("missingConfigNamesVariable", () => {
  process.env.NOTEFEED_URL = "http://x";
  process.env.NOTEFEED_TOKEN = ""; // empty counts as unset
  let err: unknown;
  try {
    new Client();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ConfigError);
  expect((err as ConfigError).message).toContain("NOTEFEED_TOKEN");
  expect((err as ConfigError).status).toBeNull();
  delete process.env.NOTEFEED_URL;
  expect(() => new Client({ token: "t", url: "" })).toThrow(/NOTEFEED_URL/);
});

describe("errorMapping", () => {
  test.each([
    [400, InvalidNoteError],
    [415, InvalidNoteError],
    [401, AuthError],
    [413, NoteTooLargeError],
    [500, NotefeedError],
  ])("%i", async (status, type) => {
    server.reply(status, { error: `reason ${status}` });
    const err = await new Client({ url: server.url, token: "t" }).post("x").catch((e) => e);
    expect(err.constructor).toBe(type);
    expect(err).toBeInstanceOf(NotefeedError);
    expect(err.status).toBe(status);
    expect(err.message).toBe(`reason ${status}`);
  });
});

test("nonJsonErrorBody", async () => {
  server.reply(502, "<html>bad gateway</html>", "text/html");
  const err = await new Client({ url: server.url, token: "t" }).post("x").catch((e) => e);
  expect(err.constructor).toBe(NotefeedError);
  expect(err.status).toBe(502);
  expect(err.message).toContain("502");
});

test("connectionRefused", async () => {
  const err = await new Client({ url: "http://127.0.0.1:1", token: "t" }).post("x").catch((e) => e);
  expect(err).toBeInstanceOf(NotefeedError);
  expect(err.status).toBeNull();
});

test("moduleLevelPost", async () => {
  expect(await post("x", { url: server.url, token: "t" })).toEqual({ id: "i", url: "u" });
});

test("nonJsonSuccessBody", async () => {
  server.reply(200, "<html>some other site</html>", "text/html");
  const err = await new Client({ url: server.url, token: "t" }).post("x").catch((e) => e);
  expect(err.constructor).toBe(NotefeedError);
  expect(err.status).toBe(200);
  expect(err.message).toContain("not a notefeed");
});
