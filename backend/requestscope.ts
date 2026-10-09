// What notefeed knows about the request it is answering, for the request line (backend/http/requestlog.ts) and for the `req` field
// that ties every other line of the same request to it (backend/log.ts). Only fixed values go in: a route's pattern and the reason of
// a refusal, never the path, the feed name or anything else the client sent.
import { AsyncLocalStorage } from "node:async_hooks";
import { processState } from "./state";

export type RequestScope = { id: string; route?: string; outcome?: string };

// One for all route bundles (see processState).
const scope = () => processState("request-scope", () => new AsyncLocalStorage<RequestScope>());

/** The request being answered; undefined outside one (start-up, tests, a timer). */
export const requestScope = (): RequestScope | undefined => scope().getStore();

/** From here on, this call and everything it starts belong to the request `s`. */
export const enterRequest = (s: RequestScope): void => scope().enterWith(s);

/** For tests: `fn` as one request. */
export const inRequest = <T>(s: RequestScope, fn: () => T): T => scope().run(s, fn);

/** The route that answers, as its pattern (`/api/v1/feeds/[feed]/notes`): a handler that knows better than the path's shape says so. */
export function noteRoute(route: string): void {
  const s = scope().getStore();
  if (s) s.route = route;
}

/** Why the request is refused: an error's code (shared/errors.ts) or another fixed word. */
export function noteOutcome(outcome: string): void {
  const s = scope().getStore();
  if (s) s.outcome = outcome;
}
