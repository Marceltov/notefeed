// Everything the backend refuses, as classes. `message` is the API's wording (lower case, no period),
// `code` the stable key the web UI words itself (shared/errors.ts). Each adapter maps the class to
// its own form; nothing parses a message.
import type { ErrorCode } from "../shared/errors";
import { ACCEPTED_TYPES } from "./note/media";

export class NotefeedError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidFeedError extends NotefeedError {
  constructor() {
    super("invalid_feed", "invalid feed name");
  }
}
export class ReservedFeedError extends NotefeedError {
  constructor() {
    super("reserved_feed", "feed name is reserved");
  }
}

export class AuthError extends NotefeedError {
  constructor() {
    super("auth", "missing or wrong password");
  }
}

/** Over a per-IP limit; `retryAfter` is the wait in whole seconds (≥ 1). */
export class RateLimitedError extends NotefeedError {
  constructor(
    readonly retryAfter: number,
    code: ErrorCode = "rate_limited",
    message = "rate limit exceeded",
  ) {
    super(code, message);
  }
}
/** Too many failed passwords: not even compared until the window ends. */
export class TooManyAttemptsError extends RateLimitedError {
  constructor(retryAfter: number) {
    super(retryAfter, "too_many_attempts", "too many attempts");
  }
}

/** NOTEFEED_MAX_FEEDS or NOTEFEED_MAX_NOTES_PER_FEED reached. */
export class LimitReachedError extends NotefeedError {}
export class FeedLimitError extends LimitReachedError {
  constructor() {
    super("feed_limit", "feed limit reached");
  }
}
export class NoteLimitError extends LimitReachedError {
  constructor() {
    super("note_limit", "note limit reached");
  }
}

export class ImageLimitError extends LimitReachedError {
  constructor() {
    super("image_limit", "image limit reached");
  }
}

/** A feed password was asked for (set, change, remove) on a feed that exists and has none. */
export class FeedExistsError extends NotefeedError {
  constructor() {
    super("feed_exists", "feed already exists and has no password");
  }
}

/** A chosen read id belongs to another feed or is held back for a reserved one. */
export class ReadIdTakenError extends NotefeedError {
  constructor() {
    super("taken", "that read id is not available");
  }
}

export class EmptyNoteError extends NotefeedError {
  constructor() {
    super("empty_note", "note is empty");
  }
}
export class NoteTooLargeError extends NotefeedError {
  constructor() {
    super("too_large", "note exceeds 100 KB");
  }
}
/** The request body can't be read as a note: the content type, or (InvalidBodyError) not UTF-8 or bad JSON. */
export class UnsupportedTypeError extends NotefeedError {
  constructor(message = `send a Content-Type of ${ACCEPTED_TYPES} (markdown as UTF-8)`) {
    super("unsupported_type", message);
  }
}
export class ImageTooLargeError extends NotefeedError {
  constructor() {
    super("too_large", "image exceeds the size limit");
  }
}
export class InvalidBodyError extends NotefeedError {
  constructor(message: string) {
    super("invalid_body", message);
  }
}

/** A path or query parameter the API can't use, e.g. `limit=0`. */
export class InvalidRequestError extends NotefeedError {
  constructor(message: string) {
    super("invalid_request", message);
  }
}
export class NotFoundError extends NotefeedError {
  constructor(message = "not found") {
    super("not_found", message);
  }
}
