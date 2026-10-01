// The HTTP status for each refusal, and the JSON error body every API endpoint answers with.
import {
  AuthError,
  EmptyNoteError,
  InvalidBodyError,
  InvalidFeedError,
  InvalidRequestError,
  LimitReachedError,
  NoteTooLargeError,
  NotFoundError,
  NotefeedError,
  RateLimitedError,
  ReservedFeedError,
  UnsupportedTypeError,
} from "../errors";

const STATUS: [new (...args: never[]) => NotefeedError, number][] = [
  [InvalidFeedError, 400],
  [ReservedFeedError, 400],
  [EmptyNoteError, 400],
  [InvalidBodyError, 400],
  [InvalidRequestError, 400],
  [AuthError, 401],
  [NotFoundError, 404],
  [NoteTooLargeError, 413],
  [UnsupportedTypeError, 415],
  [RateLimitedError, 429], // and TooManyAttemptsError
  [LimitReachedError, 507],
];

export const statusOf = (e: NotefeedError) => STATUS.find(([cls]) => e instanceof cls)?.[1] ?? 500;

// Anything that isn't a NotefeedError is a bug or a disk failure: logged, and a bare 500.
export function errorResponse(e: unknown): Response {
  if (!(e instanceof NotefeedError)) {
    console.error("request failed", e);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
  const headers = e instanceof RateLimitedError ? { "Retry-After": String(e.retryAfter) } : undefined;
  return Response.json({ error: e.message, code: e.code }, { status: statusOf(e), headers });
}
