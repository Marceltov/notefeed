/**
 * The notefeed client: a small convenience layer over the API client generated from the server's
 * OpenAPI description (./generated, `npm run generate` in the repo). No runtime dependencies.
 */
import { createClient, createConfig } from "./generated/client/index.js";
import { deleteFeed, deleteNote, editNote, getFeed, getNote, getReadNote, listNotes, listReadNotes, postNote, updateFeed, uploadImage } from "./generated/sdk.gen.js";
import type { Created, Error as ApiError, Feed, FeedSettings, ImageUploaded, Note, NoteList } from "./generated/types.gen.js";

/** The stable error codes the API answers with. */
export type ErrorCode = NonNullable<ApiError["code"]>;

export type { Created, Feed, FeedSettings, ImageUploaded, Note };
/** `timeoutMs` (default 10000) limits each whole request, including reading the answer. */
export type ClientOptions = { url: string; feed?: string; password?: string; feedPassword?: string; timeoutMs?: number };

/** Any failure talking to notefeed. `status` and `code` are null when there was no API answer. */
export class NotefeedError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly code: ErrorCode | null = null,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
/** Raised before sending: no URL, no feed, an invalid feed name or password. */
export class ConfigError extends NotefeedError {}
/** Missing or wrong password on a locked instance. */
export class AuthError extends NotefeedError {}
/** Too many posts or wrong passwords. `retryAfter` is the wait in seconds, or null if none was given. */
export class RateLimitedError extends NotefeedError {
  constructor(
    message: string,
    status: number | null,
    code: ErrorCode | null,
    readonly retryAfter: number | null,
  ) {
    super(message, status, code);
  }
}
/** No such note, or a malformed read id. */
export class NotFoundError extends NotefeedError {}
/** The instance's feed or note limit, or the feed's image limit, is reached. */
export class LimitReachedError extends NotefeedError {}
/** The note or image is over the server's size limit. */
export class NoteTooLargeError extends NotefeedError {}
/** The server refused the request itself: invalid or reserved feed, empty note, bad body or parameter. */
export class InvalidRequestError extends NotefeedError {}

const BY_CODE: Partial<Record<ErrorCode, typeof NotefeedError>> = {
  auth: AuthError,
  not_found: NotFoundError,
  feed_limit: LimitReachedError,
  note_limit: LimitReachedError,
  image_limit: LimitReachedError,
  too_large: NoteTooLargeError,
  invalid_feed: InvalidRequestError,
  reserved_feed: InvalidRequestError,
  empty_note: InvalidRequestError,
  invalid_body: InvalidRequestError,
  invalid_request: InvalidRequestError,
  feed_exists: InvalidRequestError,
  unsupported_type: InvalidRequestError,
};

const FEED_RE = /^[a-z0-9_-]{1,64}$/; // same rule as the server; reserved names still come back as a 400

type Result<T> = { data?: T; error?: unknown; response?: Response };

export class Client {
  readonly url: string;
  readonly feed: string | null;
  private readonly api;
  private readonly timeoutMs: number;
  private readonly feedPassword: string | null;

  /** A notefeed server. The feed set here is the default for every call; each call can override it. */
  constructor(options: ClientOptions) {
    const { url, feed, password, feedPassword, timeoutMs } = options ?? ({} as Partial<ClientOptions>);
    if (!url) throw new ConfigError("no url given");
    this.url = url.replace(/\/+$/, "");
    this.feed = feed ? checkFeed(feed) : null;
    const pw = password?.trim() || null;
    // Never echo the value: it would end up in terminals and CI logs.
    if (pw && /[\x00-\x1f\x7f]/.test(pw)) throw new ConfigError("password contains invalid characters");
    this.feedPassword = checkFeedPassword(feedPassword);
    this.timeoutMs = timeoutMs ?? 10_000;
    this.api = createClient(createConfig({ baseUrl: this.url, headers: pw ? { Authorization: `Bearer ${pw}` } : {} }));
  }

  /** NOTEFEED_URL, NOTEFEED_FEED, NOTEFEED_PASSWORD and NOTEFEED_FEED_PASSWORD. */
  static fromEnv(env: Record<string, string | undefined> = process.env): Client {
    return new Client({
      url: env.NOTEFEED_URL ?? "",
      feed: env.NOTEFEED_FEED || undefined,
      password: env.NOTEFEED_PASSWORD,
      feedPassword: env.NOTEFEED_FEED_PASSWORD,
    });
  }

  /** `feedPassword` overrides the client's, for a feed that has its own password. */
  async post(markdown: string, options: { feed?: string; feedPassword?: string } = {}): Promise<Created> {
    const feed = this.feedFor(options.feed);
    return this.call(postNote({ client: this.api, path: { feed }, body: { markdown }, ...this.opts(options.feedPassword) }));
  }

  /** Upload a PNG, JPEG, GIF or WebP image to an existing feed. The server decides the format by the bytes, so no content type is needed. `markdown` in the answer is `![](url)`, to put in a note. Same options as post(). */
  async uploadImage(data: Uint8Array | Blob, options: { feed?: string; feedPassword?: string } = {}): Promise<ImageUploaded> {
    const feed = this.feedFor(options.feed);
    const body = data instanceof Blob ? data : new Blob([data as BlobPart]);
    const headers = { ...this.opts(options.feedPassword).headers, "Content-Type": "application/octet-stream" };
    return this.call(uploadImage({ client: this.api, path: { feed }, body, signal: AbortSignal.timeout(this.timeoutMs), headers }));
  }

  /** Replace a note's markdown; its id and URLs stay. Same options as post(). */
  async edit(id: string, markdown: string, options: { feed?: string; feedPassword?: string } = {}): Promise<Note> {
    const feed = this.feedFor(options.feed);
    return this.call(editNote({ client: this.api, path: { feed, id }, body: { markdown }, ...this.opts(options.feedPassword) }));
  }

  /** Remove a note for good. The feed stays, even with no notes left. Same options as post(). */
  async delete(id: string, options: { feed?: string; feedPassword?: string } = {}): Promise<void> {
    const feed = this.feedFor(options.feed);
    await this.call(deleteNote({ client: this.api, path: { feed, id }, ...this.opts(options.feedPassword) }));
  }

  /** The feed's name, title, description, whether it has a password, and its read link (null while it has no notes). Same options as post(). */
  async feedInfo(options: { feed?: string; feedPassword?: string } = {}): Promise<Feed> {
    const feed = this.feedFor(options.feed);
    return this.call(getFeed({ client: this.api, path: { feed }, ...this.opts(options.feedPassword) }));
  }

  /** Replace the feed's title and description (both; an empty string clears one), and set (`image`: a file name from uploadImage) or clear (`""`) the title image; leave `image` out to keep it. The feed must already exist. Same options as post(). */
  async updateFeed(settings: FeedSettings, options: { feed?: string; feedPassword?: string } = {}): Promise<Feed> {
    const feed = this.feedFor(options.feed);
    const body = { title: settings.title, description: settings.description, ...(settings.image === undefined ? {} : { image: settings.image }) };
    return this.call(updateFeed({ client: this.api, path: { feed }, body, ...this.opts(options.feedPassword) }));
  }

  /** Delete the feed with all its notes, settings and password, for good; its name is free again. Same options as post(). */
  async deleteFeed(options: { feed?: string; feedPassword?: string } = {}): Promise<void> {
    const feed = this.feedFor(options.feed);
    await this.call(deleteFeed({ client: this.api, path: { feed }, ...this.opts(options.feedPassword) }));
  }

  /** Every note in the feed, newest first, fetched a page at a time; stop iterating whenever you like. */
  notes(options: { feed?: string; feedPassword?: string; pageSize?: number } = {}): AsyncGenerator<Note> {
    const feed = this.feedFor(options.feed);
    return this.pages((before) =>
      listNotes({ client: this.api, path: { feed }, query: { limit: options.pageSize, before }, ...this.opts(options.feedPassword) }),
    );
  }

  async note(id: string, options: { feed?: string; feedPassword?: string } = {}): Promise<Note> {
    const feed = this.feedFor(options.feed);
    return this.call(getNote({ client: this.api, path: { feed, id }, ...this.opts(options.feedPassword) }));
  }

  /** Like notes(), by the feed's read id: public, read-only, needs no password. */
  readNotes(readId: string, options: { pageSize?: number } = {}): AsyncGenerator<Note> {
    return this.pages((before) =>
      listReadNotes({ client: this.api, path: { readId }, query: { limit: options.pageSize, before }, ...this.opts() }),
    );
  }

  async readNote(readId: string, id: string): Promise<Note> {
    return this.call(getReadNote({ client: this.api, path: { readId, id }, ...this.opts() }));
  }

  private feedFor(feed: string | undefined): string {
    const f = feed || this.feed;
    if (!f) throw new ConfigError("no feed given");
    return checkFeed(f);
  }

  private opts(feedPassword?: string) {
    const fp = checkFeedPassword(feedPassword) ?? this.feedPassword;
    return { signal: AbortSignal.timeout(this.timeoutMs), headers: fp ? { "X-Feed-Password": fp } : {} };
  }

  // `before` is the previous page's `next`: older notes only, so notes posted meanwhile never repeat.
  private async *pages(fetchPage: (before?: string) => Promise<Result<NoteList>>): AsyncGenerator<Note> {
    let before: string | undefined;
    do {
      const page = await this.call(fetchPage(before));
      yield* page.notes;
      before = page.next ?? undefined;
    } while (before);
  }

  // Anything but a JSON object from the API itself is an error, never a success: a POST that was
  // redirected (http → https) came back as a GET of the list, so the note was never stored.
  private async call<T>(request: Promise<Result<T>>): Promise<T> {
    const { data, error, response } = await request;
    if (!response) {
      const cause = (error as { cause?: { code?: string; message?: string } } | undefined)?.cause;
      const reason = cause?.code ?? cause?.message ?? (error as Error | undefined)?.message ?? "unknown error";
      throw new NotefeedError(`could not reach ${this.url}: ${reason}`);
    }
    if (response.redirected) {
      throw new NotefeedError(`${this.url} redirected to ${new URL(response.url).origin}: use that address as the URL`, response.status);
    }
    if (response.status === 204 && error === undefined) return undefined as T; // delete: no body
    if (response.ok) {
      if (error === undefined && isObject(data)) return data as T;
      throw new NotefeedError(`unexpected response from ${this.url} (not a notefeed server?)`, response.status);
    }
    const body = isObject(error) ? (error as Partial<ApiError>) : null;
    const code = typeof body?.code === "string" ? body.code : null;
    let message = typeof body?.error === "string" ? body.error : "";
    if (!message) {
      const raw = typeof error === "string" ? error : isObject(error) && Object.keys(error).length ? JSON.stringify(error) : "";
      message = `HTTP ${response.status}: ${raw.slice(0, 200).replace(/\s+/g, " ").trim()}`.replace(/: $/, "");
    }
    if (code === "rate_limited" || code === "too_many_attempts" || response.status === 429) {
      const retry = response.headers.get("retry-after")?.trim() ?? "";
      throw new RateLimitedError(message, response.status, code, /^\d+$/.test(retry) ? Number(retry) : null);
    }
    const Cls = (code && BY_CODE[code]) || NotefeedError;
    throw new Cls(message, response.status, code);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkFeed(feed: string): string {
  // Never echo the name: it is the write key.
  if (!FEED_RE.test(feed)) throw new ConfigError("invalid feed name: use 1-64 of a-z, 0-9, _ and -");
  return feed;
}

function checkFeedPassword(value: string | undefined): string | null {
  const v = value?.trim() || null;
  // Never echo the value: it would end up in terminals and CI logs.
  if (v && /[\x00-\x1f\x7f]/.test(v)) throw new ConfigError("feed password contains invalid characters");
  return v;
}
