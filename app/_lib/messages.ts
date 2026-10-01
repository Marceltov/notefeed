// The web UI's wording for the backend's error codes (shared/errors.ts), from a form post's
// ?error=&retry= or a fetch() error body. Runs on the server and in the browser.
import type { ErrorCode } from "@/shared/errors";
import { PASSWORD_RULE } from "@/shared/password";

// Under a new-password field, and what the browser says when the field's pattern doesn't match.
export const PASSWORD_HINT = `Use ${PASSWORD_RULE}: unaccented letters, digits and symbols.`;

const MESSAGES: Record<ErrorCode, string> = {
  invalid_feed: "Invalid feed name.",
  reserved_feed: "That feed name is reserved.",
  auth: "That password doesn't match NOTEFEED_PASSWORD.",
  rate_limited: "Too many notes, try again in {retry} seconds.",
  too_many_attempts: "Too many attempts, try again in {retry} seconds.",
  feed_limit: "This instance has reached its feed limit.",
  note_limit: "This feed has reached its note limit.",
  empty_note: "The note is empty.",
  too_large: "The note is over 100 KB.",
  unsupported_type: "The note could not be read.",
  invalid_body: "The note could not be read.",
  invalid_request: "Something went wrong.",
  not_found: "Not found.",
  feed_exists: "This feed already exists, so it can't be given a password.",
};

// undefined for no code; an unknown code still says something.
export function errorMessage(code: unknown, retry?: unknown): string | undefined {
  if (typeof code !== "string" || code === "") return undefined;
  const text = MESSAGES[code as ErrorCode] ?? "Something went wrong.";
  return text.replace("{retry}", /^\d+$/.test(String(retry)) ? String(retry) : "a few");
}

// The same, on the feed password screens, where "auth" and "invalid_body" are about a feed password.
export function feedErrorMessage(code: unknown, retry?: unknown): string | undefined {
  if (code === "auth") return "That password is wrong.";
  if (code === "invalid_body") return `The new password must be ${PASSWORD_RULE}.`;
  return errorMessage(code, retry);
}
