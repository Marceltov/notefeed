import { afterEach, describe, expect, test, vi } from "vitest";
import * as z from "zod";
import { RateLimitedError } from "../errors";
import { createDispatcher, op } from "./dispatch";

const Thing = z.object({ id: z.string(), limit: z.number() });
const NotFound = { description: "Not found", schema: z.object({ error: z.string(), code: z.string().optional() }) };

let seen: unknown;
let behave: () => Promise<unknown> = async () => undefined;
const getThing = op({
  method: "GET",
  path: "/api/v1/things/{id}",
  operationId: "getThing",
  summary: "Get a thing",
  tags: ["Test"],
  params: { id: z.string() },
  query: z.object({ limit: z.coerce.number().int().min(1).default(50) }),
  responses: { 200: { description: "The thing", schema: Thing }, 400: NotFound, 404: NotFound },
}).handle(async ({ params, query }) => {
  seen = query;
  await behave();
  return { status: 200, body: { id: params.id, limit: query.limit } };
});
const postThing = op({
  method: "POST",
  path: "/api/v1/things/{id}",
  operationId: "postThing",
  summary: "Post a thing",
  tags: ["Test"],
  params: { id: z.string() },
  responses: { 303: { description: "Elsewhere" } },
}).handle(async () => ({ status: 303, body: undefined, headers: { Location: "/x" } }));

// The compiler rejects a reply the entry doesn't declare.
op({
  method: "GET",
  path: "/api/v1/nope",
  operationId: "nope",
  summary: "x",
  tags: [],
  params: {},
  responses: { 200: { description: "ok", schema: Thing }, 404: NotFound },
  // @ts-expect-error 201 is not declared
}).handle(async () => ({ status: 201, body: { id: "a", limit: 1 } }));

const dispatch = createDispatcher([getThing, postThing]);
const call = (path: string, method = "GET") => dispatch(new Request(`http://x/api/v1/${path}`, { method }), path.split("?")[0].split("/"));

afterEach(() => {
  behave = async () => undefined;
  seen = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("routing", () => {
  test("an unknown path is a JSON 404", async () => {
    const res = await call("nothing/here");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no such endpoint", code: "not_found" });
  });
  test("HEAD is served like GET (Next calls the GET export for HEAD)", async () => {
    const res = await call("things/a", "HEAD");
    expect(res.status).toBe(200);
  });
  test("a known path with the wrong method is a 405 with Allow", async () => {
    const res = await call("things/a", "PUT");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD, POST");
    expect(await res.json()).toEqual({ error: "method not allowed" });
  });
});

describe("query", () => {
  test("is parsed with the entry's schema", async () => {
    expect(await (await call("things/a?limit=2")).json()).toEqual({ id: "a", limit: 2 });
  });
  test("a bad value is a 400 invalid_request and the handler never runs", async () => {
    const res = await call("things/a?limit=abc");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
    expect(seen).toBeUndefined();
  });
  test("an empty value counts as absent", async () => {
    await call("things/a?limit=");
    expect(seen).toEqual({ limit: 50 });
  });
  test("a repeated value: the last wins", async () => {
    await call("things/a?limit=2&limit=3");
    expect(seen).toEqual({ limit: 3 });
  });
});

describe("replies", () => {
  test("an undeclared status never leaves: logged, 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const sneaky = { ...getThing, handle: async () => ({ status: 418 as 200, body: { id: "a", limit: 1 } }) };
    const res = await createDispatcher([sneaky])(new Request("http://x/api/v1/things/a"), ["things", "a"]);
    expect(res.status).toBe(500);
    expect(log).toHaveBeenCalled();
  });
  test("a thrown NotefeedError becomes its status and body, with Retry-After", async () => {
    behave = async () => {
      throw new RateLimitedError(7);
    };
    const sneaky = { ...getThing, responses: { ...getThing.responses, 429: NotFound } };
    const res = await createDispatcher([sneaky])(new Request("http://x/api/v1/things/a"), ["things", "a"]);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(await res.json()).toEqual({ error: "rate limit exceeded", code: "rate_limited" });
  });
  test("a thrown error whose status the entry doesn't declare never leaves either: logged, 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    behave = async () => {
      throw new RateLimitedError(7); // 429, which getThing doesn't declare
    };
    const res = await call("things/a");
    expect(res.status).toBe(500);
    expect(log).toHaveBeenCalled();
  });
  test("a thrown plain Error is a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    behave = async () => {
      throw new Error("x");
    };
    const res = await call("things/a");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal error" });
  });
  test("a body that doesn't match its schema throws outside production, is sent in production", async () => {
    const bad = { ...getThing, handle: async () => ({ status: 200 as const, body: { id: 1 } as never }) };
    const d = createDispatcher([bad]);
    const req = () => new Request("http://x/api/v1/things/a");
    await expect(d(req(), ["things", "a"])).rejects.toThrow("getThing answered 200 with a body that doesn't match its schema");
    vi.stubEnv("NODE_ENV", "production");
    expect(await (await d(req(), ["things", "a"])).json()).toEqual({ id: 1 });
  });
  test("a reply without a body is empty, with its headers", async () => {
    const res = await call("things/a", "POST");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/x");
    expect(await res.text()).toBe("");
  });
});
