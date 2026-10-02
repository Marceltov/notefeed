// Stable codes for what the backend refuses: in API error bodies ({"error", "code"}) and in the
// web UI's ?error= after a form post. The web UI words them (app/_lib/messages.ts).
export const ERROR_CODES = [
  "invalid_feed",
  "reserved_feed",
  "auth",
  "rate_limited",
  "too_many_attempts",
  "feed_limit",
  "note_limit",
  "image_limit",
  "empty_note",
  "too_large",
  "unsupported_type",
  "invalid_body",
  "invalid_request",
  "not_found",
  "feed_exists",
  "taken",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
