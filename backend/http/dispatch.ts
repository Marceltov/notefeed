// Table entries and the dispatcher for /api/v1. An entry's handler is typed from the entry's own
// declared responses, so it can't return a status or body shape the API description doesn't list;
// the dispatcher enforces the same at runtime for what types can't see (thrown errors, formats).
import * as z from "zod";
import { InvalidRequestError, NotFoundError } from "../errors";
import { errorReply } from "./errors";

// A response without a schema has no body (e.g. a 303); headers are documented, not enforced.
export type ResponseSpec = {
  description: string;
  schema?: z.ZodType;
  headers?: Record<string, { description: string; type: "integer" | "string" }>;
};

type BodyOf<R> = R extends { schema: infer S extends z.ZodType } ? z.infer<S> : undefined;
export type Reply<R> = {
  [S in keyof R & number]: { status: S; body: BodyOf<R[S]>; headers?: Record<string, string> };
}[keyof R & number];

type QueryOf<Q> = Q extends z.ZodObject ? z.infer<Q> : Record<string, never>;

type Meta<R, Q> = {
  method: "GET" | "POST";
  path: string; // OpenAPI template including /api/v1, e.g. "/api/v1/feeds/{feed}/notes"
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  password?: true; // needs the instance password when one is set
  params: Record<string, z.ZodType>;
  query?: Q;
  body?: Record<string, z.ZodType>;
  responses: R;
  // Runs before the query is validated, so a refusal for who is asking or what they named (401,
  // invalid feed) wins over a complaint about their parameters. Throws to refuse.
  before?: (input: { req: Request; params: Record<string, string> }) => void;
};
export type Handler<R, Q> = (input: { req: Request; params: Record<string, string>; query: QueryOf<Q> }) => Promise<Reply<R>>;
export type Op<
  R extends Record<number, ResponseSpec> = Record<number, ResponseSpec>,
  Q extends z.ZodObject | undefined = z.ZodObject | undefined,
> = Meta<R, Q> & { handle: Handler<R, Q> };

type AnyReply = { status: number; body?: unknown; headers?: Record<string, string> };
// Any entry, as the dispatcher sees it: the per-entry typing is checked where the entry is declared.
export type AnyOp = Meta<Record<number, ResponseSpec>, z.ZodObject | undefined> & { handle: (input: never) => Promise<AnyReply> };

// Declares an entry: op({...}).handle(async (input) => reply). Two calls on purpose: the first fixes
// the declared responses, so the handler's replies are checked against them with literal statuses
// (in one call, TypeScript widens `status: 200` to number before it knows the declared ones).
export function op<const R extends Record<number, ResponseSpec>, Q extends z.ZodObject | undefined = undefined>(
  meta: Meta<R, Q>,
): { handle: (h: Handler<R, Q>) => Op<R, Q> } {
  return { handle: (handle) => ({ ...meta, handle }) };
}

// The entries for a path, whatever the method, with its path parameters. `segments` are the decoded
// path after `prefix` (Next's catch-all param), so "a%2Fb" is one segment "a/b".
export function matchOps(ops: AnyOp[], prefix: string, segments: string[]): { ops: AnyOp[]; params: Record<string, string> } | null {
  const found: AnyOp[] = [];
  let params: Record<string, string> = {};
  for (const o of ops) {
    if (!o.path.startsWith(prefix + "/")) continue;
    const tpl = o.path.slice(prefix.length + 1).split("/");
    if (tpl.length !== segments.length) continue;
    const p: Record<string, string> = {};
    if (tpl.every((t, i) => (t.startsWith("{") ? ((p[t.slice(1, -1)] = segments[i]), true) : t === segments[i]))) {
      found.push(o);
      params = p;
    }
  }
  return found.length ? { ops: found, params } : null;
}

// Empty values count as absent; of repeated keys, the last wins.
function queryOf(req: Request): Record<string, string> {
  const entries = [...new URL(req.url).searchParams].filter(([, v]) => v !== "");
  return Object.fromEntries(entries);
}

function send(entry: AnyOp, reply: AnyReply): Response {
  const declared = (entry.responses as Record<number, ResponseSpec>)[reply.status];
  if (!declared) {
    console.error(`${entry.operationId} answered ${reply.status}, which it doesn't declare`);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
  // Types can't see formats and patterns (or a thrown error's body); check them wherever it's cheap to fail.
  if (process.env.NODE_ENV !== "production" && declared.schema) {
    const checked = declared.schema.safeParse(reply.body);
    if (!checked.success) {
      throw new Error(`${entry.operationId} answered ${reply.status} with a body that doesn't match its schema: ${z.prettifyError(checked.error)}`, {
        cause: checked.error,
      });
    }
  }
  if (reply.body === undefined) return new Response(null, { status: reply.status, headers: reply.headers });
  return Response.json(reply.body, { status: reply.status, headers: reply.headers });
}

// `prefix` is where the catch-all route is mounted (e.g. "/api/v1"); entry paths include it.
export function createDispatcher(ops: AnyOp[], prefix: string): (req: Request, segments: string[]) => Promise<Response> {
  return async (req, segments) => {
    const m = matchOps(ops, prefix, segments);
    if (!m) return Response.json(errorReply(new NotFoundError("no such endpoint")).body, { status: 404 });
    // Next answers HEAD by calling the GET export with the request as is; it drops the body itself.
    const method = req.method === "HEAD" ? "GET" : req.method;
    const entry = m.ops.find((o) => o.method === method);
    if (!entry) {
      const methods = m.ops.map((o) => o.method);
      const allow = (methods.includes("GET") ? [...methods, "HEAD"] : methods).sort().join(", ");
      return Response.json({ error: "method not allowed" }, { status: 405, headers: { Allow: allow } });
    }
    let reply: AnyReply;
    try {
      entry.before?.({ req, params: m.params });
      let query: Record<string, unknown> = {};
      if (entry.query) {
        const parsed = entry.query.safeParse(queryOf(req));
        if (!parsed.success) throw new InvalidRequestError(z.prettifyError(parsed.error).replace(/\s+/g, " ").replace(/^✖ /, ""));
        query = parsed.data;
      }
      reply = await entry.handle({ req, params: m.params, query } as never);
    } catch (e) {
      reply = errorReply(e);
      if (reply.status === 500) return Response.json(reply.body, { status: 500 }); // never declared, always allowed
    }
    return send(entry, reply);
  };
}
