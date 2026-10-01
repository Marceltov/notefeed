// Stable codes for what the backend refuses: in API error bodies ({"error", "code"}) and in the
// web UI's ?error= after a form post. The web UI words them (app/_lib/messages.ts).
export type ErrorCode =
  | "invalid_feed"
  | "reserved_feed"
  | "auth"
  | "rate_limited"
  | "too_many_attempts"
  | "feed_limit"
  | "note_limit"
  | "empty_note"
  | "too_large"
  | "unsupported_type"
  | "invalid_body";
