import { NextRequest } from "next/server";
import { expect, test } from "vitest";
import { proxy } from "./proxy";

test("unauthenticated requests get a relative redirect to /login", () => {
  process.env.NOTEFEED_TOKEN = "s3cret";
  const res = proxy(new NextRequest("http://internal:3000/n/x"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("/login");
});
