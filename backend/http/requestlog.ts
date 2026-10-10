// The request line: one `info` line per request, written here for every route (Next's pages and route handlers, the dispatcher's
// operations, static files) because this listens to Node's HTTP server itself rather than to any of them (ADR 0025). It carries the
// method, the route's pattern, the status, the time to answer, the bytes sent and, for a refusal, its reason. Never the path, the
// query, the feed name, the client's address, a header or anything of the body: the same rules as backend/log.ts.
import { randomBytes } from "node:crypto";
import { subscribe } from "node:diagnostics_channel";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../config";
import { logger } from "../log";
import { enterRequest, inRequest, type RequestScope } from "../requestscope";
import { processState } from "../state";

const log = logger("http");

// Every page and route handler under app/, as Next names them (requestlog.test.ts holds this list to the folder).
export const ROUTES = [
  "/",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource/mcp",
  "/[feed]",
  "/[feed]/[id]",
  "/[feed]/access",
  "/[feed]/delete",
  "/[feed]/details",
  "/[feed]/settings",
  "/api/login",
  "/api/oauth/authorize",
  "/api/oidc/callback",
  "/api/oidc/start",
  "/api/operator/images/move",
  "/api/operator/images/unreferenced",
  "/api/operator/takedown",
  "/api/v1/[...path]",
  "/imprint",
  "/login",
  "/logout",
  "/mcp",
  "/metrics",
  "/oauth/authorize",
  "/oauth/register",
  "/oauth/token",
  "/privacy",
  "/r/[readId]",
  "/r/[readId]/[id]",
  "/r/[readId]/feed.xml",
  "/r/[readId]/files/[file]",
  "/report",
];

const ASSETS = "/_next/*";
const FILE = "/[file]";
// Logged at `debug`, so that `info` stays readable: the app's own scripts, styles and icons, and the scrape of /metrics.
const QUIET = new Set([ASSETS, FILE, "/metrics"]);

type Pattern = { route: string; segments: string[]; rest: boolean };
// A fixed segment wins over a parameter, as in Next: the patterns are tried with the fixed ones first.
const rank = (p: Pattern) => p.segments.map((s) => (s.startsWith("[") ? "1" : "0")).join("");
const PATTERNS: Pattern[] = ROUTES.map((route) => {
  const segments = route.split("/").filter(Boolean);
  return { route, segments, rest: segments.at(-1)?.startsWith("[...") ?? false };
}).sort((a, b) => rank(a).localeCompare(rank(b)));

/**
 * The pattern of the route a path belongs to, by its shape alone; undefined for a path that is none of notefeed's. `/_next/*` is Next's
 * own files and `/[file]` a file at the top (an icon, the manifest): a feed name has no dot. A handler reached through a rewrite
 * names its own route (noteRoute).
 */
export function routeOf(path: string): string | undefined {
  const pathname = path.split(/[?#]/, 1)[0];
  if (pathname.startsWith("/_next/")) return ASSETS;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 1 && segments[0].includes(".")) return FILE;
  return PATTERNS.find((p) => {
    const fixed = p.rest ? p.segments.slice(0, -1) : p.segments;
    if (p.rest ? segments.length <= fixed.length : segments.length !== fixed.length) return false;
    return fixed.every((s, i) => s.startsWith("[") || s === segments[i]);
  })?.route;
}

// For a refusal by a route that said nothing (Next's own 404, /mcp's 401): what the status alone says.
const BY_STATUS: Record<number, string> = { 401: "auth", 404: "not_found", 429: "rate_limited" };

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/**
 * The line for one answered request. `outcome` is what the handler said (noteOutcome), or else what a 401, 404 or 429 says by
 * itself; a response the client did not wait for is `aborted`.
 */
export function requestLine(scope: RequestScope, r: { method: string; path: string; status: number; ms: number; bytes?: number; finished: boolean }): void {
  const route = scope.route ?? routeOf(r.path);
  const outcome = !r.finished ? "aborted" : (scope.outcome ?? BY_STATUS[r.status]);
  const fields = { method: METHODS.has(r.method) ? r.method : "OTHER", route, status: r.status, ms: Math.round(r.ms), bytes: r.bytes, outcome };
  // Inside the request's scope, which gives the line its `req`: the response's `close` comes from the connection, not from the request.
  inRequest(scope, () => (route && QUIET.has(route) ? log.debug(fields, "request") : log.info(fields, "request")));
}

/**
 * Starts the request log, once per process (instrumentation.ts). Every request gets its scope here, before Next sees it, so the
 * proxy, the pages and the handlers all run inside it; the line is written when the response is done or the client is gone.
 */
export function installRequestLog(): void {
  processState("request-log", () => {
    subscribe("http.server.request.start", (message) => {
      try {
        const { request, response, socket } = message as { request: IncomingMessage; response: ServerResponse; socket: { bytesWritten: number } };
        const scope: RequestScope = { id: randomBytes(6).toString("base64url") };
        enterRequest(scope);
        if (!config.logRequests()) return;
        const start = performance.now();
        const before = socket.bytesWritten;
        const method = request.method ?? "";
        const path = request.url ?? "";
        response.once("close", () => {
          try {
            // The bytes sent for this response, its headers included: the body's own length is not known for a streamed page.
            requestLine(scope, { method, path, status: response.statusCode, ms: performance.now() - start, bytes: socket.bytesWritten - before, finished: response.writableFinished });
          } catch {}
        });
      } catch {} // nothing the log does ever reaches the request
    });
    return {};
  });
}

// React's error for a page whose reader left while it was still being sent. Next prints it as an error of its own (a plain line with
// a stack, outside the JSON), although nothing went wrong; the request line already says `aborted`.
const CLIENT_LEFT = "The destination stream closed early.";
export const isClientLeft = (args: unknown[]): boolean => args.some((a) => a instanceof Error && a.message === CLIENT_LEFT);

/** Keeps that one error out of the output, once per process (instrumentation.ts); everything else Next prints stays. */
export function dropClientLeftErrors(): void {
  processState("client-left", () => {
    const print = console.error;
    console.error = (...args: unknown[]) => {
      if (!isClientLeft(args)) print.apply(console, args);
    };
    return {};
  });
}
