import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test } from "vitest";
import { proxy } from "./proxy";

beforeEach(() => {
  process.env.NOTEFEED_TOKEN = "s3cret";
});
afterEach(() => {
  delete process.env.PUBLIC_URL;
});

// Next's proxy runtime rejects a relative Location ("Invalid URL" → 500), so it must be absolute
// and point at the public address, not the internal one.
test("redirects to the public /login behind a reverse proxy", () => {
  const req = new NextRequest("http://internal:3000/n/x", {
    headers: { "x-forwarded-proto": "https", "x-forwarded-host": "notes.example" },
  });
  const res = proxy(req);
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("https://notes.example/login");
});

test("PUBLIC_URL wins for the redirect", () => {
  process.env.PUBLIC_URL = "https://notefeed.example.com";
  const res = proxy(new NextRequest("http://internal:3000/", { headers: { host: "internal:3000" } }));
  expect(res.headers.get("location")).toBe("https://notefeed.example.com/login");
});
