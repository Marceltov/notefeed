// Every environment variable the backend reads. Getters, not constants: tests change the environment
// between cases, and DATA_DIR is only known at runtime.
const env = (name: string) => process.env[name] ?? "";

// Unset, empty or not a number → `fallback`.
function int(name: string, fallback: number): number {
  const raw = env(name);
  return raw === "" || !Number.isFinite(Number(raw)) ? fallback : Number(raw);
}

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
  maxNotesPerFeed: () => Math.max(0, int("NOTEFEED_MAX_NOTES_PER_FEED", 0)),
};
