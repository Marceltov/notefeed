// Every environment variable the backend reads. Getters, not constants: tests change the environment
// between cases, and DATA_DIR is only known at runtime.
const env = (name: string) => process.env[name] ?? "";

// Unset, empty or not a number → `fallback`. A fraction is cut to a whole number (a cap of 0.5 is no cap, not a cap below 1).
function int(name: string, fallback: number): number {
  const raw = env(name);
  return raw === "" || !Number.isFinite(Number(raw)) ? fallback : Math.trunc(Number(raw));
}

export const LOG_LEVELS = ["error", "warn", "info", "debug", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const positive = (name: string, fallback: number) => (int(name, fallback) > 0 ? int(name, fallback) : fallback);

export const STORAGE_KINDS = ["fs", "sqlite", "postgres"] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];

function storageKind(): StorageKind {
  const v = env("NOTEFEED_STORAGE").trim().toLowerCase();
  if (v === "") return "fs";
  if ((STORAGE_KINDS as readonly string[]).includes(v)) return v as StorageKind;
  throw new Error(`NOTEFEED_STORAGE must be one of ${STORAGE_KINDS.join(", ")}, got "${v}"`);
}

const dataDir = () => env("DATA_DIR") || "/data";

// SQLite defaults to a file next to where `fs` keeps its data, so the same volume works.
const databaseUrl = () => env("NOTEFEED_DATABASE_URL") || (storageKind() === "sqlite" ? `file:${dataDir().replace(/\/+$/, "")}/notefeed.db` : "");

// Where a database backend keeps image bytes: in the row, in a folder, or in an S3-compatible object store.
export const IMAGE_STORES = ["db", "fs", "s3"] as const;
export type ImageStoreKind = (typeof IMAGE_STORES)[number];

function imageStoreKind(): ImageStoreKind {
  const v = env("NOTEFEED_IMAGES").trim().toLowerCase();
  if (v === "") return "db";
  if ((IMAGE_STORES as readonly string[]).includes(v)) return v as ImageStoreKind;
  throw new Error(`NOTEFEED_IMAGES must be one of ${IMAGE_STORES.join(", ")}, got "${v}"`);
}

const imagesDir = () => env("NOTEFEED_IMAGES_DIR") || `${dataDir().replace(/\/+$/, "")}/images`;

// Any S3-compatible store: the endpoint is required, there is no default provider. Stores without regions expect us-east-1.
const s3 = () => ({
  endpoint: env("NOTEFEED_S3_ENDPOINT").trim().replace(/\/+$/, ""),
  bucket: env("NOTEFEED_S3_BUCKET").trim(),
  region: env("NOTEFEED_S3_REGION").trim() || "us-east-1",
  accessKey: env("NOTEFEED_S3_ACCESS_KEY"),
  secretKey: env("NOTEFEED_S3_SECRET_KEY"),
});

// At startup, so a wrong setting shows then and not on the first signed cookie. The URL itself is never in a message,
// nor is the endpoint or a key of the image store.
function validateStorage(): void {
  const kind = storageKind();
  const images = imageStoreKind();
  if (kind === "fs" && images !== "db") throw new Error(`NOTEFEED_IMAGES=${images} needs NOTEFEED_STORAGE=sqlite or postgres: the file system backend keeps images in the feed's folder`);
  if (images === "s3") {
    const { endpoint, bucket, accessKey, secretKey } = s3();
    const missing = Object.entries({ NOTEFEED_S3_ENDPOINT: endpoint, NOTEFEED_S3_BUCKET: bucket, NOTEFEED_S3_ACCESS_KEY: accessKey, NOTEFEED_S3_SECRET_KEY: secretKey }).flatMap(([k, v]) => (v === "" ? [k] : []));
    if (missing.length) throw new Error(`NOTEFEED_IMAGES=s3 needs ${missing.join(", ")}`);
    if (!/^https?:\/\//i.test(endpoint) || !URL.canParse(endpoint)) throw new Error("NOTEFEED_S3_ENDPOINT must be an http(s) URL");
  }
  if (kind === "fs") return;
  if (kind === "postgres" && databaseUrl() === "") throw new Error("NOTEFEED_STORAGE=postgres needs NOTEFEED_DATABASE_URL");
  if (Buffer.byteLength(env("NOTEFEED_SECRET")) < 32) {
    throw new Error(`NOTEFEED_STORAGE=${kind} needs NOTEFEED_SECRET of at least 32 bytes (e.g. openssl rand -hex 32): there is no data folder to keep a generated one in`);
  }
}

/** The built-in report page's link template (issue #156): the ids go into the page's hidden fields. */
export const REPORT_PAGE = "/report?read_id={read_id}&note_id={note_id}&file={file}";

export const config = {
  dataDir,
  storage: storageKind,
  databaseUrl,
  validateStorage,
  images: imageStoreKind,
  imagesDir,
  s3,
  // Empty means unset: compose passes ${NOTEFEED_PASSWORD:-} and ${NOTEFEED_SECRET:-}.
  password: () => env("NOTEFEED_PASSWORD"),
  secret: () => env("NOTEFEED_SECRET"),
  publicUrl: () => env("PUBLIC_URL").replace(/\/+$/, ""),
  title: () => env("NOTEFEED_TITLE") || "notefeed",
  // The operator's own imprint and privacy page: Markdown files (see legal.ts). Empty: the page does not exist.
  imprintFile: () => env("NOTEFEED_IMPRINT_FILE"),
  privacyFile: () => env("NOTEFEED_PRIVACY_FILE"),
  // The operator's notice on the start page, a Markdown file too. Empty: no notice.
  noticeFile: () => env("NOTEFEED_NOTICE_FILE"),
  // Where the built-in report page (/report) posts a report: the endpoint of a form in an inbox such as noticebox.
  // Empty: there is no page.
  reportEndpoint: () => env("NOTEFEED_REPORT_ENDPOINT").trim(),
  // A URL template for the "Report" link on every note (shared/report.ts fills {read_id}, {note_id} and {file}).
  // Unset with an endpoint set, the link opens the built-in page; unset without one, there is no link.
  reportUrl: () => env("NOTEFEED_REPORT_URL").trim() || (env("NOTEFEED_REPORT_ENDPOINT").trim() ? REPORT_PAGE : ""),
  trustProxy: () => env("NOTEFEED_TRUST_PROXY") === "1",
  // Per minute and IP; 0 or below turns it off.
  rateLimit: () => int("NOTEFEED_RATE_LIMIT", 60),
  // 0 or below: no cap.
  maxFeeds: () => Math.max(0, int("NOTEFEED_MAX_FEEDS", 0)),
  // Comma-separated feed names nobody may create, on top of the built-in list (see feeds.ts).
  reservedFeeds: () => env("NOTEFEED_RESERVED_FEEDS").split(",").map((n) => n.trim()).filter(Boolean),
  // Password of the reserved feeds, which exist only while this is set (see feeds.ts).
  reservedPassword: () => env("NOTEFEED_RESERVED_PASSWORD"),
  // "0" leaves only random read ids: nothing chosen is accepted (empty, a random one, still is).
  allowCustomIds: () => env("NOTEFEED_ALLOW_CUSTOM_IDS") !== "0",
  // How long reading a text to place its pictures may take, in ms (it runs in a worker, so a slow text costs only its sender that time).
  parseTimeoutMs: () => positive("NOTEFEED_PARSE_TIMEOUT_MS", 10_000),
  // The request line (backend/http/requestlog.ts) is on unless this is "0".
  logRequests: () => env("NOTEFEED_LOG_REQUESTS").trim() !== "0",
  // "1" turns on GET /metrics (Prometheus format); with a token set it needs `Authorization: Bearer <token>`.
  metrics: () => env("NOTEFEED_METRICS") === "1",
  metricsToken: () => env("NOTEFEED_METRICS_TOKEN"),
  // The bearer of the operator's endpoints (backend/http/operator.ts), which can delete: at least 32 bytes, or they stay off (404).
  operatorToken: () => (Buffer.byteLength(env("NOTEFEED_OPERATOR_TOKEN")) >= 32 ? env("NOTEFEED_OPERATOR_TOKEN") : ""),
  operatorTokenTooShort: () => env("NOTEFEED_OPERATOR_TOKEN") !== "" && Buffer.byteLength(env("NOTEFEED_OPERATOR_TOKEN")) < 32,
  maxNotesPerFeed: () => Math.max(0, int("NOTEFEED_MAX_NOTES_PER_FEED", 0)),
  // Bytes per uploaded image; 0 or below means the default, and nothing above 10 MiB: Next's proxy buffers a request
  // body only up to that, so a larger image would arrive cut. Images per feed: 0 or below, no cap.
  maxImageBytes: () => Math.min(positive("NOTEFEED_MAX_IMAGE_BYTES", 5242880), 10485760),
  maxImagesPerFeed: () => Math.max(0, int("NOTEFEED_MAX_IMAGES_PER_FEED", 0)),
  // "0" refuses every image upload (API, MCP, web UI; an image note, a replaced one or a picture sent with a text) with
  // `images_off`; stored images keep being served. Anything else is on.
  imageUploads: () => env("NOTEFEED_IMAGE_UPLOADS").trim() !== "0",
  // Unset, empty or not a level → info (the startup line warns about the last).
  logLevel: (): LogLevel => ((l) => (LOG_LEVELS as readonly string[]).includes(l) ? (l as LogLevel) : "info")(env("NOTEFEED_LOG_LEVEL").trim().toLowerCase()),
  // Optional OIDC sign-in (see oidc/config.ts): one provider per set of variables. `name` "" is the unprefixed
  // set (NOTEFEED_OIDC_ISSUER, ...); any other is NOTEFEED_OIDC_<name>_ISSUER, ... Issuer, client credentials, who may
  // sign in (comma-separated addresses, @domain entries or *; lowercased), and the button's label.
  oidc: (name = "") => {
    const v = (k: string) => env(`NOTEFEED_OIDC_${name ? `${name}_` : ""}${k}`);
    return {
      issuer: v("ISSUER"),
      clientId: v("CLIENT_ID"),
      clientSecret: v("CLIENT_SECRET"),
      allow: v("ALLOW").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean),
      // id_token claims tried in order for the sender (case-sensitive); not part of "the provider is on".
      senderClaim: ((l) => (l.length ? l : ["name", "email"]))(v("SENDER_CLAIM").split(",").map((n) => n.trim()).filter(Boolean)),
      label: v("LABEL").trim(),
    };
  },
  // The names of the named providers: every NOTEFEED_OIDC_<NAME>_ISSUER that is set (the unprefixed ISSUER can't match).
  oidcNames: () => Object.keys(process.env).flatMap((k) => /^NOTEFEED_OIDC_([A-Z0-9]+(?:_[A-Z0-9]+)*)_ISSUER$/.exec(k)?.[1] ?? []),
};
