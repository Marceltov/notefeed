import { readdirSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { NotFoundError, RateLimitedError } from "../errors";
import { logger, logsOf, logTo } from "../log";
import { inRequest, noteOutcome, noteRoute, requestScope } from "../requestscope";
import { errorReply } from "./errors";
import { installRequestLog, isClientLeft, requestLine, routeOf, ROUTES } from "./requestlog";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

// Every page.tsx and route.ts under app/, as the route Next serves it at.
function appRoutes(dir = "app", at = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return appRoutes(join(dir, e.name), `${at}/${e.name}`);
    return e.name === "page.tsx" || e.name === "route.ts" ? [at || "/"] : [];
  });
}

test("ROUTES is every page and route handler of app/", () => {
  expect([...ROUTES].sort()).toEqual(appRoutes().sort());
});

test.each([
  ["/", "/"],
  ["/myfeed", "/[feed]"],
  ["/myfeed/", "/[feed]"],
  ["/myfeed?tag=x", "/[feed]"],
  ["/myfeed/20260101T000000000Z-abcd", "/[feed]/[id]"],
  ["/myfeed/settings", "/[feed]/settings"],
  ["/login", "/login"],
  ["/mcp", "/mcp"],
  ["/r/abc", "/r/[readId]"],
  ["/r/abc/feed.xml", "/r/[readId]/feed.xml"],
  ["/r/abc/files/a.png", "/r/[readId]/files/[file]"],
  ["/api/v1/feeds/myfeed/notes", "/api/v1/[...path]"],
  ["/api/login", "/api/login"],
  ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource/mcp"],
  ["/_next/static/chunks/a.js", "/_next/*"],
  ["/icon.svg", "/[file]"],
  ["/manifest.webmanifest", "/[file]"],
  ["/a/b/c/d", undefined],
  ["/api/v1", "/[feed]/[id]"], // as Next sees it: a note page of a feed named `api`, which answers 404
])("routeOf(%s) is %s", (path, route) => {
  expect(routeOf(path)).toBe(route);
});

const line = (over: Partial<Parameters<typeof requestLine>[1]> = {}) => ({ method: "GET", path: "/secret-feed?tag=secret-tag", status: 200, ms: 12.4, bytes: 4312, finished: true, ...over });

test("the request line: method, route pattern, status, ms, bytes and the request's id, and nothing of the path", async () => {
  const logs = await logsOf(() => requestLine({ id: "r1" }, line()));
  expect(logs).toEqual([{ level: "info", component: "http", msg: "request", req: "r1", method: "GET", route: "/[feed]", status: 200, ms: 12, bytes: 4312 }]);
  expect(JSON.stringify(logs)).not.toMatch(/secret/);
});

test("a handler's route and outcome win over the path's shape", async () => {
  const logs = await logsOf(() => requestLine({ id: "r1", route: "/api/v1/feeds/[feed]/notes", outcome: "rate_limited" }, line({ method: "POST", status: 429 })));
  expect(logs[0]).toMatchObject({ method: "POST", route: "/api/v1/feeds/[feed]/notes", status: 429, outcome: "rate_limited" });
});

test("a path that is no route has no route; a bare 404 or 401 has the outcome its status says, a response the client left is aborted", async () => {
  const logs = await logsOf(() => {
    requestLine({ id: "a" }, line({ path: "/a/b/c/d", status: 404 }));
    requestLine({ id: "b" }, line({ finished: false }));
    requestLine({ id: "c" }, line({ method: "PROPFIND", status: 401 }));
  });
  expect(logs[0]).toEqual({ level: "info", component: "http", msg: "request", req: "a", method: "GET", status: 404, ms: 12, bytes: 4312, outcome: "not_found" });
  expect(logs[1].outcome).toBe("aborted");
  expect(logs[2]).toMatchObject({ method: "OTHER", status: 401, outcome: "auth" });
});

test("static files and the metrics scrape are logged at debug only", async () => {
  const all = () => ["/_next/static/a.js", "/icon.svg", "/metrics", "/myfeed"].forEach((path) => requestLine({ id: "r" }, line({ path })));
  expect((await logsOf(all, "info")).map((l) => l.route)).toEqual(["/[feed]"]);
  expect((await logsOf(all, "debug")).map((l) => [l.level, l.route])).toEqual([["debug", "/_next/*"], ["debug", "/[file]"], ["debug", "/metrics"], ["info", "/[feed]"]]);
});

test("every line logged inside a request carries its id; outside there is none", async () => {
  const logs = await logsOf(() => {
    inRequest({ id: "r7" }, () => logger("oidc").info("inside"));
    logger("oidc").info("outside");
  });
  expect(logs).toEqual([{ level: "info", component: "oidc", msg: "inside", req: "r7" }, { level: "info", component: "oidc", msg: "outside" }]);
});

test("a refusal's code is the outcome; an unexpected failure is `error`", async () => {
  const outcomeOf = (e: unknown) => inRequest({ id: "r" }, () => (errorReply(e), requestScope()!.outcome));
  expect(outcomeOf(new RateLimitedError(3))).toBe("rate_limited");
  expect(outcomeOf(new NotFoundError())).toBe("not_found");
  const restore = logTo(() => {});
  expect(outcomeOf(new Error("boom"))).toBe("error");
  restore();
});

// A real server: the log listens to Node's HTTP server, whoever handles the request.
const call = (server: Server, method: string, path: string) =>
  new Promise<number>((resolve, reject) => {
    const req = httpRequest({ port: (server.address() as AddressInfo).port, method, path, agent: false }, (res) => res.resume().on("end", () => resolve(res.statusCode!)));
    req.on("error", reject).end();
  });

async function served(run: (server: Server) => Promise<unknown>): Promise<Record<string, unknown>[]> {
  installRequestLog();
  const server = createServer((req, res) => {
    // What a handler does: it runs inside the request's scope without being handed anything.
    if (req.url!.startsWith("/api/")) noteRoute("/api/v1/feeds/[feed]/notes");
    if (req.method === "POST") noteOutcome("auth");
    logger("posting").info("handled");
    res.writeHead(req.method === "POST" ? 401 : 200, { "Content-Type": "text/plain" }).end("hello");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await logsOf(async () => {
      await run(server);
      await new Promise((r) => setTimeout(r, 50)); // the line is written when the response closes
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("a served request gets one line, tied by `req` to what its handler logged", async () => {
  const logs = await served(async (server) => {
    expect(await call(server, "GET", "/secret-feed?x=secret")).toBe(200);
    expect(await call(server, "POST", "/api/v1/feeds/secret-feed/notes")).toBe(401);
  });
  const requests = logs.filter((l) => l.msg === "request");
  expect(requests).toEqual([
    { level: "info", component: "http", msg: "request", req: expect.any(String), method: "GET", route: "/[feed]", status: 200, ms: expect.any(Number), bytes: expect.any(Number) },
    { level: "info", component: "http", msg: "request", req: expect.any(String), method: "POST", route: "/api/v1/feeds/[feed]/notes", status: 401, ms: expect.any(Number), bytes: expect.any(Number), outcome: "auth" },
  ]);
  expect(requests[0].bytes as number).toBeGreaterThan(5);
  expect(requests[0].req).not.toBe(requests[1].req);
  expect(logs.filter((l) => l.msg === "handled").map((l) => l.req)).toEqual(requests.map((l) => l.req));
  expect(JSON.stringify(logs)).not.toMatch(/secret/);
});

test("NOTEFEED_LOG_REQUESTS=0 turns the request line off; the other lines keep their request id", async () => {
  process.env.NOTEFEED_LOG_REQUESTS = "0";
  const logs = await served((server) => call(server, "GET", "/myfeed"));
  expect(logs).toEqual([{ level: "info", component: "posting", msg: "handled", req: expect.any(String) }]);
});

test("only React's error for a reader who left is kept out of Next's output", () => {
  expect(isClientLeft(["⨯", new Error("The destination stream closed early.")])).toBe(true);
  expect(isClientLeft(["⨯", new Error("something else")])).toBe(false);
  expect(isClientLeft(["The destination stream closed early."])).toBe(false);
});
