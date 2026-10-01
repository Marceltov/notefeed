// Everything the backend refuses, as classes. Messages are the API's wording (lower case, no period);
// each adapter maps the class to its own form: an HTTP status in backend/http, a sentence in the web UI.
export class NotefeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidFeedError extends NotefeedError {
  constructor() {
    super("invalid feed name");
  }
}
export class ReservedFeedError extends NotefeedError {
  constructor() {
    super("feed name is reserved");
  }
}

export class AuthError extends NotefeedError {
  constructor() {
    super("missing or wrong password");
  }
}

/** Over a per-IP limit; `retryAfter` is the wait in whole seconds (≥ 1). */
export class RateLimitedError extends NotefeedError {
  constructor(
    readonly retryAfter: number,
    message = "rate limit exceeded",
  ) {
    super(message);
  }
}
/** Too many failed passwords: not even compared until the window ends. */
export class TooManyAttemptsError extends RateLimitedError {
  constructor(retryAfter: number) {
    super(retryAfter, "too many attempts");
  }
}

/** NOTEFEED_MAX_FEEDS or NOTEFEED_MAX_NOTES_PER_FEED reached. */
export class LimitReachedError extends NotefeedError {}
export class FeedLimitError extends LimitReachedError {
  constructor() {
    super("feed limit reached");
  }
}
export class NoteLimitError extends LimitReachedError {
  constructor() {
    super("note limit reached");
  }
}

export class EmptyNoteError extends NotefeedError {
  constructor() {
    super("note is empty");
  }
}
export class NoteTooLargeError extends NotefeedError {
  constructor() {
    super("note exceeds 100 KB");
  }
}
/** The request body can't be read as a note: the content type, or (InvalidBodyError) not UTF-8 or bad JSON. */
export class UnsupportedTypeError extends NotefeedError {
  constructor() {
    super("send text/markdown, text/plain or application/json");
  }
}
export class InvalidBodyError extends NotefeedError {}
