/**
 * The notefeed client: a small convenience layer over the API client generated from the server's
 * OpenAPI description (./generated, `npm run generate` in the repo). No runtime dependencies.
 */
import { createClient, createConfig } from "./generated/client/index.js";
import { deleteFeed, deleteNote, editNote, getFeed, getNote, getReadNote, listNotes, listReadNotes, patchNote, postNote, updateFeed } from "./generated/sdk.gen.js";
import type { Created, Error as ApiError, Feed, FeedSettings, Note, NoteList } from "./generated/types.gen.js";

/** The stable error codes the API answers with. */
export type ErrorCode = NonNullable<ApiError["code"]>;

export type { Created, Feed, FeedSettings, Note };
/** A picture posted with a note: `![](name)` in the markdown refers to it. `type` as for post(). */
export type Attachment = { name: string; content: Uint8Array | Blob; type?: string; alt?: string };
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
/** No such note, or a malformed read id; also a feed the operator removed for good (`removed`, 410). */
export class NotFoundError extends NotefeedError {}
/** The instance's feed or note limit, or the feed's image limit, is reached. */
export class LimitReachedError extends NotefeedError {}
/** The note or image is over the server's size limit. */
export class NoteTooLargeError extends NotefeedError {}
/** The instance takes no pictures (`NOTEFEED_IMAGE_UPLOADS=0`): an image, a replaced picture or attachments were refused. */
export class ImagesOffError extends NotefeedError {}
/** The server refused the request itself: invalid or reserved feed, empty note, bad body or parameter, or an image on the instance's blocklist (`blocked`, 451). */
export class InvalidRequestError extends NotefeedError {}

const BY_CODE: Partial<Record<ErrorCode, typeof NotefeedError>> = {
  auth: AuthError,
  not_found: NotFoundError,
  feed_limit: LimitReachedError,
  note_limit: LimitReachedError,
  image_limit: LimitReachedError,
  images_off: ImagesOffError,
  too_large: NoteTooLargeError,
  invalid_feed: InvalidRequestError,
  reserved_feed: InvalidRequestError,
  empty_note: InvalidRequestError,
  invalid_body: InvalidRequestError,
  invalid_request: InvalidRequestError,
  feed_exists: InvalidRequestError,
  taken: InvalidRequestError,
  removed: NotFoundError,
  blocked: InvalidRequestError,
  unsupported_type: InvalidRequestError,
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const FEED_RE = /^[a-z0-9_-]{1,64}$/; // same rule as the server; reserved names still come back as a 400

type Result<T> = { data?: T; error?: unknown; response?: Response };

// A header holds bytes, and fetch refuses a character above U+00FF: text that may not be ASCII goes as its UTF-8 bytes written as
// latin1 characters, which is what the server reads back.
const headerValue = (text: string): string => Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join("");

// What a post sends: a string is markdown; bytes and Blobs need a media type (a Blob's own, if it has one).
function asFile(content: string | Uint8Array | Blob, type?: string): { body: Blob; type: string } {
  if (typeof content === "string") return { body: new Blob([content]), type: type ?? "text/markdown" };
  const media = type ?? (content instanceof Blob ? content.type : "");
  if (!media) throw new ConfigError("give the file's media type as `type`, e.g. image/png");
  return { body: content instanceof Blob ? content : new Blob([content as BlobPart]), type: media };
}

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

  /**
   * Post a note: a string is markdown, bytes or a Blob are a file whose media type is `type` (a Blob's own `type` if left out): `text/markdown`,
   * `image/png`, `image/jpeg`, `image/gif` or `image/webp`. The server accepts nothing else and checks that the body is what the type says.
   * The feed is created by its first note. `Created.file` is the note's file name: write `![](file)` in a markdown note to show a picture, or
   * pass it as `image` to updateFeed; `file_url` is for a link outside notefeed.
   *
   * `feedPassword` overrides the client's, for a feed that has its own password. `tags` label the note (at most 10, each 1 to 32 characters of
   * letters, digits, `-`, `_`, `.`, `:`; not verified). `title` is its title (at most 100 characters, one line); left out, it is taken from the
   * text. `alt` is a picture's alternative text, `name` the file's original name. `readId` is the read id the feed gets when this post creates it
   * (3 to 64 characters of `a-z`, `0-9`, `-`, `_`; random when left out; ignored for a feed that exists; a `taken` error when another feed has it).
   *
   * `attachments` are pictures posted with the note in one request: `![](name)` in the markdown shows one (a picture the text never refers to is
   * added at the end), and `Created.attachments` lists them in order. `tags` label the pictures too. `content` may be `null` when there are
   * attachments: only the pictures are posted, `title` and `tags` go on each, and the result is the first picture plus `attachments`. Checked
   * here, before anything is sent (ConfigError): a name given twice, an attachment that is not a picture, content that is not markdown, `alt` or
   * `name` with attachments. What a name may be is the server's rule (docs/using/pictures.md, "Posting a note with its pictures"): a name it refuses is an
   * InvalidRequestError, `attachment "<name>": ...`, and whenever the server refuses any part (its message names it) nothing is posted.
   */
  async post(
    content: string | Uint8Array | Blob | null,
    options: { feed?: string; feedPassword?: string; type?: string; title?: string; tags?: string[]; alt?: string; name?: string; readId?: string; attachments?: Attachment[] } = {},
  ): Promise<Created & { attachments: Created[] }> {
    const { attachments = [], ...own } = options;
    if (content === null && attachments.length === 0) throw new ConfigError("no content and no attachments");
    if (attachments.length === 0) return { ...(await this.postOne(content!, own)), attachments: [] };
    if (content !== null && (typeof content !== "string" || (own.type ?? "text/markdown") !== "text/markdown")) throw new ConfigError("attachments go with a markdown string");
    if (own.alt || own.name) throw new ConfigError("alt and name do not go with attachments: give each attachment its alt");
    const form = new FormData();
    if (content !== null) form.append("text", new Blob([content], { type: "text/markdown" }));
    for (const a of attachments) {
      if (attachments.findIndex((b) => b.name === a.name) !== attachments.indexOf(a)) throw new ConfigError(`attachment "${a.name}" is given twice`);
      const { body, type } = asFile(a.content, a.type);
      if (!IMAGE_TYPES.includes(type)) throw new ConfigError(`attachment "${a.name}" must be a picture (${IMAGE_TYPES.join(", ")})`);
      form.append("file", new Blob([body], { type }), a.name);
      if (a.alt) form.append(`alt.${a.name}`, a.alt);
    }
    const feed = this.feedFor(own.feed);
    const headers = {
      ...this.opts(own.feedPassword).headers,
      "Content-Type": null, // fetch sets multipart/form-data with its boundary
      ...(own.title && { "X-Note-Title": headerValue(own.title) }),
      ...(own.tags?.length && { "X-Note-Tags": own.tags.join(",") }),
      ...(own.readId && { "X-Read-Id": own.readId }),
    };
    const created = await this.call(postNote({ client: this.api, path: { feed }, body: form as never, headers, signal: AbortSignal.timeout(this.timeoutMs) }));
    return { ...created, attachments: created.attachments ?? [] };
  }

  private async postOne(
    content: string | Uint8Array | Blob,
    options: { feed?: string; feedPassword?: string; type?: string; title?: string; tags?: string[]; alt?: string; name?: string; readId?: string },
  ): Promise<Created> {
    const feed = this.feedFor(options.feed);
    const { body, type } = asFile(content, options.type);
    const headers = {
      ...this.opts(options.feedPassword).headers,
      "Content-Type": type,
      ...(options.title && { "X-Note-Title": headerValue(options.title) }),
      ...(options.tags?.length && { "X-Note-Tags": options.tags.join(",") }),
      ...(options.alt && { "X-Note-Alt": headerValue(options.alt) }),
      ...(options.name && { "X-Note-Name": headerValue(options.name) }),
      ...(options.readId && { "X-Read-Id": options.readId }),
    };
    return this.call(postNote({ client: this.api, path: { feed }, body, headers, signal: AbortSignal.timeout(this.timeoutMs) }));
  }

  /** Replace a note's content (a string is markdown; bytes and Blobs need the note's own `type`, as for post()). Its id, URLs and metadata stay. Same options as post(). */
  async edit(id: string, content: string | Uint8Array | Blob, options: { feed?: string; feedPassword?: string; type?: string } = {}): Promise<Note> {
    const feed = this.feedFor(options.feed);
    const { body, type } = asFile(content, options.type);
    const headers = { ...this.opts(options.feedPassword).headers, "Content-Type": type };
    return this.call(editNote({ client: this.api, path: { feed, id }, body, headers, signal: AbortSignal.timeout(this.timeoutMs) }));
  }

  /** Set a note's title and/or alt text (alt for pictures); `""` removes one, so a markdown note's title follows its text again. Same options as post(). */
  async update(id: string, meta: { title?: string; alt?: string }, options: { feed?: string; feedPassword?: string } = {}): Promise<Note> {
    const feed = this.feedFor(options.feed);
    return this.call(patchNote({ client: this.api, path: { feed, id }, body: meta, ...this.opts(options.feedPassword) }));
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

  /** Replace the feed's title and description (both; an empty string clears one), and set (`image`: a file name from uploadImage) or clear (`""`) the title image; leave `image` out to keep it. `read_id` gives the feed another read id (3 to 64 characters of `a-z`, `0-9`, `-`, `_`; `""` for a random one; left out keeps it); the old one is freed, and relative image links in notes follow while full URLs do not. The feed must already exist. Same options as post(). */
  async updateFeed(settings: FeedSettings, options: { feed?: string; feedPassword?: string } = {}): Promise<Feed> {
    const feed = this.feedFor(options.feed);
    const body = { title: settings.title, description: settings.description, ...(settings.image === undefined ? {} : { image: settings.image }), ...(settings.read_id === undefined ? {} : { read_id: settings.read_id }) };
    return this.call(updateFeed({ client: this.api, path: { feed }, body, ...this.opts(options.feedPassword) }));
  }

  /** Delete the feed with all its notes, settings and password, for good; its name is free again. Same options as post(). */
  async deleteFeed(options: { feed?: string; feedPassword?: string } = {}): Promise<void> {
    const feed = this.feedFor(options.feed);
    await this.call(deleteFeed({ client: this.api, path: { feed }, ...this.opts(options.feedPassword) }));
  }

  /** Every note in the feed, newest first, fetched a page at a time; stop iterating whenever you like. `tag`: only notes carrying it. */
  notes(options: { feed?: string; feedPassword?: string; pageSize?: number; tag?: string } = {}): AsyncGenerator<Note> {
    const feed = this.feedFor(options.feed);
    return this.pages((before) =>
      listNotes({ client: this.api, path: { feed }, query: { limit: options.pageSize, before, tag: options.tag }, ...this.opts(options.feedPassword) }),
    );
  }

  async note(id: string, options: { feed?: string; feedPassword?: string } = {}): Promise<Note> {
    const feed = this.feedFor(options.feed);
    return this.call(getNote({ client: this.api, path: { feed, id }, ...this.opts(options.feedPassword) }));
  }

  /** Like notes(), by the feed's read id: public, read-only, needs no password. */
  readNotes(readId: string, options: { pageSize?: number; tag?: string } = {}): AsyncGenerator<Note> {
    return this.pages((before) =>
      listReadNotes({ client: this.api, path: { readId }, query: { limit: options.pageSize, before, tag: options.tag }, ...this.opts() }),
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
