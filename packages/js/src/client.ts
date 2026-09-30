/** A tiny client for notefeed's POST /api/notes. No dependencies; uses the global fetch. */

export type Note = { id: string; url: string };
export type ClientOptions = { url: string; token: string; timeoutMs?: number };

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
/** URL or token missing. */
export class ConfigError extends NotefeedError {}
/** The server rejected the note (400, 415): empty, not UTF-8, wrong type. */
export class InvalidNoteError extends NotefeedError {}
/** Missing or wrong token (401). */
export class AuthError extends NotefeedError {}
/** The note is over the server's size limit (413). */
export class NoteTooLargeError extends NotefeedError {}

const ERRORS: Record<number, typeof NotefeedError> = {
  400: InvalidNoteError,
  415: InvalidNoteError,
  401: AuthError,
  413: NoteTooLargeError,
};

export class Client {
  readonly url: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  /** A notefeed server. URL and token are set once here; post() takes only the note. */
  constructor(options: ClientOptions) {
    const { url, token, timeoutMs } = options ?? ({} as Partial<ClientOptions>);
    if (!url) throw new ConfigError("no url given");
    if (!token?.trim()) throw new ConfigError("no token given");
    this.url = url.replace(/\/+$/, "");
    this.token = token.trim();
    // Never echo the value: it would end up in terminals and CI logs.
    if (/[\x00-\x1f\x7f]/.test(this.token)) throw new ConfigError("token contains invalid characters");
    this.timeoutMs = timeoutMs ?? 10_000;
  }

  async post(markdown: string): Promise<Note> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/api/notes`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "text/markdown; charset=utf-8" },
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
      throw new (ERRORS[res.status] ?? NotefeedError)(message, res.status);
    }
    try {
      const { id, url } = JSON.parse(text) as Note;
      if (typeof id === "string" && typeof url === "string") return { id, url };
    } catch {}
    throw new NotefeedError(`unexpected response from ${this.url} (not a notefeed server?)`, res.status);
  }
}

