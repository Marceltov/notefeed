// Every environment variable the backend reads. Getters, not constants: tests change the environment
// between cases, and DATA_DIR is only known at runtime.
const env = (name: string) => process.env[name] ?? "";

// Unset, empty or not a number → `fallback`.
function int(name: string, fallback: number): number {
  const raw = env(name);
  return raw === "" || !Number.isFinite(Number(raw)) ? fallback : Number(raw);
}

const positive = (name: string, fallback: number) => (int(name, fallback) > 0 ? int(name, fallback) : fallback);

export const config = {
  dataDir: () => env("DATA_DIR") || "/data",
  // Empty means unset: compose passes ${NOTEFEED_PASSWORD:-} and ${NOTEFEED_SECRET:-}.
  password: () => env("NOTEFEED_PASSWORD"),
  secret: () => env("NOTEFEED_SECRET"),
  publicUrl: () => env("PUBLIC_URL").replace(/\/+$/, ""),
  title: () => env("NOTEFEED_TITLE") || "notefeed",
  trustProxy: () => env("NOTEFEED_TRUST_PROXY") === "1",
  // Per minute and IP; 0 or below turns it off.
  rateLimit: () => int("NOTEFEED_RATE_LIMIT", 60),
  // 0 or below: no cap.
  maxFeeds: () => Math.max(0, int("NOTEFEED_MAX_FEEDS", 0)),
  // Comma-separated feed names nobody may create, on top of the built-in list (see feeds.ts).
  reservedFeeds: () => env("NOTEFEED_RESERVED_FEEDS").split(",").map((n) => n.trim()).filter(Boolean),
  // Password of the reserved feeds, which exist only while this is set (see feeds.ts).
  reservedPassword: () => env("NOTEFEED_RESERVED_PASSWORD"),
  maxNotesPerFeed: () => Math.max(0, int("NOTEFEED_MAX_NOTES_PER_FEED", 0)),
  // Bytes per uploaded image; 0 or below means the default, and nothing above 10 MiB: Next's proxy buffers a request
  // body only up to that, so a larger image would arrive cut. Images per feed: 0 or below, no cap.
  maxImageBytes: () => Math.min(positive("NOTEFEED_MAX_IMAGE_BYTES", 5242880), 10485760),
  maxImagesPerFeed: () => Math.max(0, int("NOTEFEED_MAX_IMAGES_PER_FEED", 0)),
  // Optional OIDC sign-in (see oidc/config.ts): issuer, client credentials, and who may sign in
  // (comma-separated addresses, @domain entries or *; lowercased).
  oidc: () => ({
    issuer: env("NOTEFEED_OIDC_ISSUER"),
    clientId: env("NOTEFEED_OIDC_CLIENT_ID"),
    clientSecret: env("NOTEFEED_OIDC_CLIENT_SECRET"),
    allow: env("NOTEFEED_OIDC_ALLOW").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean),
  }),
};
