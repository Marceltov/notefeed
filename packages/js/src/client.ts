/** A tiny client for notefeed's POST /<feed>. No dependencies; uses the global fetch. */

export type Note = { id: string; url: string; readUrl: string };
export type ClientOptions = { url: string; feed?: string; password?: string; timeoutMs?: number };
export type PostOptions = { feed?: string };

/** Any failure talking to notefeed. `status` is the HTTP status, or null (network, config). */
export class NotefeedError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
/** URL or feed missing, or an invalid feed name or password. */
export class ConfigError extends NotefeedError {}
/** The server rejected the note (400, 415): empty, not UTF-8, wrong type. */
export class InvalidNoteError extends NotefeedError {}
/** Missing or wrong password on a locked instance (401). */
export class AuthError extends NotefeedError {}
/** The note is over the server's size limit (413). */
export class NoteTooLargeError extends NotefeedError {}

/** Too many requests (429). `retryAfter` is the wait in seconds, or null if the server gave none. */
export class RateLimitedError extends NotefeedError {
  constructor(
    message: string,
    status: number | null = null,
    readonly retryAfter: number | null = null,
  ) {
    super(message, status);
  }
}
/** The server's feed or note limit is reached (507). */
export class LimitReachedError extends NotefeedError {}

const ERRORS: Record<number, typeof NotefeedError> = {
  400: InvalidNoteError,
  415: InvalidNoteError,
  401: AuthError,
  413: NoteTooLargeError,
  507: LimitReachedError,
};

// Same rule as the server; reserved names still come back as a 400.
function checkFeed(feed: string): string {
  if (!/^[a-z0-9_-]{1,64}$/.test(feed)) {
    throw new ConfigError("invalid feed name: use 1-64 of a-z, 0-9, _ and -"); // never echo the name: it is the write key
  }
  return feed;
}

export class Client {
  readonly url: string;
  readonly feed: string | null;
  private readonly password: string | null;
  private readonly timeoutMs: number;

  /** A notefeed server. The feed set here is the default; post(md, { feed }) overrides it. */
  constructor(options: ClientOptions) {
    const { url, feed, password, timeoutMs } = options ?? ({} as Partial<ClientOptions>);
    if (!url) throw new ConfigError("no url given");
    this.url = url.replace(/\/+$/, "");
    this.feed = feed ? checkFeed(feed) : null;
    this.password = password?.trim() || null;
    // Never echo the value: it would end up in terminals and CI logs.
    if (this.password && /[\x00-\x1f\x7f]/.test(this.password)) {
      throw new ConfigError("password contains invalid characters");
    }
    this.timeoutMs = timeoutMs ?? 10_000;
  }

  async post(markdown: string, options: PostOptions = {}): Promise<Note> {
    const feed = options.feed || this.feed;
    if (!feed) throw new ConfigError("no feed given");
    checkFeed(feed);
    const headers: Record<string, string> = { "Content-Type": "text/markdown; charset=utf-8" };
    if (this.password) headers.Authorization = `Bearer ${this.password}`;
    let res: Response;
    try {
      res = await fetch(`${this.url}/${feed}`, {
        method: "POST",
        headers,
        body: new TextEncoder().encode(markdown),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      const reason = cause?.code ?? cause?.message ?? (e as Error).message;
      throw new NotefeedError(`could not reach ${this.url}: ${reason}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let message: string;
      try {
        message = JSON.parse(text).error;
        if (typeof message !== "string") throw new Error();
      } catch {
        message = `HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, " ").trim()}`;
      }
      if (res.status === 429) {
        const retry = res.headers.get("retry-after")?.trim() ?? "";
        throw new RateLimitedError(message, 429, /^\d+$/.test(retry) ? Number(retry) : null);
      }
      throw new (ERRORS[res.status] ?? NotefeedError)(message, res.status);
    }
    try {
      const { id, url, read_url } = JSON.parse(text) as { id: unknown; url: unknown; read_url: unknown };
      if (typeof id === "string" && typeof url === "string" && typeof read_url === "string") {
        return { id, url, readUrl: read_url };
      }
    } catch {}
    throw new NotefeedError(`unexpected response from ${this.url} (not a notefeed server?)`, res.status);
  }
}

