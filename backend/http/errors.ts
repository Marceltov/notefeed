// The HTTP status for each refusal, and the JSON error body every API endpoint answers with.
import type { ErrorCode } from "../../shared/errors";
import {
  AuthError,
  BlockedImageError,
  EmptyNoteError,
  FeedExistsError,
  ImageTooLargeError,
  InvalidBodyError,
  InvalidFeedError,
  InvalidRequestError,
  LimitReachedError,
  ReadIdTakenError,
  NoteTooLargeError,
  NotFoundError,
  NotefeedError,
  RateLimitedError,
  RemovedFeedError,
  ReservedFeedError,
  UnsupportedTypeError,
} from "../errors";
import { logger } from "../log";
import { noteOutcome } from "../requestscope";

const log = logger("http");

const STATUS: [new (...args: never[]) => NotefeedError, number][] = [
  [InvalidFeedError, 400],
  [ReservedFeedError, 400],
  [EmptyNoteError, 400],
  [InvalidBodyError, 400],
  [InvalidRequestError, 400],
  [AuthError, 401],
  [NotFoundError, 404],
  [FeedExistsError, 409],
  [ReadIdTakenError, 409],
  [RemovedFeedError, 410],
  [NoteTooLargeError, 413],
  [ImageTooLargeError, 413],
  [UnsupportedTypeError, 415],
  [RateLimitedError, 429], // and TooManyAttemptsError
  [BlockedImageError, 451],
  [LimitReachedError, 507],
];

export const statusOf = (e: NotefeedError) => STATUS.find(([cls]) => e instanceof cls)?.[1] ?? 500;

export type ErrorReply = { status: number; body: { error: string; code?: ErrorCode }; headers?: Record<string, string> };

// Anything that isn't a NotefeedError is a bug or a disk failure: logged, and a bare 500.
export function errorReply(e: unknown): ErrorReply {
  if (!(e instanceof NotefeedError)) {
    log.error({ err: e }, "request failed");
    noteOutcome("error");
    return { status: 500, body: { error: "internal error" } };
  }
  noteOutcome(e.code);
  const headers = e instanceof RateLimitedError ? { "Retry-After": String(e.retryAfter) } : undefined;
  return { status: statusOf(e), body: { error: e.message, code: e.code }, headers };
}

export function errorResponse(e: unknown): Response {
  const { status, body, headers } = errorReply(e);
  return Response.json(body, { status, headers });
}
