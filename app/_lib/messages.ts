// The web UI's wording for the backend's error codes (shared/errors.ts), from a form post's
// ?error=&retry= or a fetch() error body. Runs on the server and in the browser.
import type { ErrorCode } from "@/shared/errors";
import { PASSWORD_RULE } from "@/shared/password";

// Under a new-password field, and what the browser says when the field's pattern doesn't match.
export const PASSWORD_HINT = `Use ${PASSWORD_RULE}: unaccented letters, digits and symbols.`;

// Under the sign-in button and the compose box while sign-in is on.
export const SENDER_NOTICE = "Your name is shown on your notes, including on the public read link and RSS.";

// sign_in_failed is no API code: only the OIDC callback's ?error= (backend/oidc/routes.ts).
const MESSAGES: Record<ErrorCode | "sign_in_failed", string> = {
  invalid_feed: "Invalid feed name.",
  reserved_feed: "That feed name is reserved.",
  auth: "That password doesn't match NOTEFEED_PASSWORD.",
  rate_limited: "Too many requests, try again in {retry} seconds.",
  too_many_attempts: "Too many attempts, try again in {retry} seconds.",
  feed_limit: "This instance has reached its feed limit.",
  note_limit: "This feed has reached its note limit.",
  image_limit: "This feed has reached its image limit.",
  empty_note: "The note is empty.",
  too_large: "The note is over 100 KB.",
  unsupported_type: "The note could not be read.",
  invalid_body: "The note could not be read.",
  invalid_request: "Something went wrong.",
  not_found: "Not found.",
  feed_exists: "This feed already exists, so it can't be given a password.",
  taken: "That read id is taken. Choose another.",
  sign_in_failed: "Sign-in didn't work. Try again.",
};

// undefined for no code; an unknown code still says something.
export function errorMessage(code: unknown, retry?: unknown): string | undefined {
  if (typeof code !== "string" || code === "") return undefined;
  const text = Object.hasOwn(MESSAGES, code) ? MESSAGES[code as keyof typeof MESSAGES] : "Something went wrong."; // not `in`/`??`: "constructor" is inherited
  return text.replace("{retry}", /^\d+$/.test(String(retry)) ? String(retry) : "a few");
}

// The same, on the feed password screens, where "auth" and "invalid_body" are about a feed password.
export function feedErrorMessage(code: unknown, retry?: unknown): string | undefined {
  if (code === "auth") return "That password is wrong.";
  if (code === "invalid_body") return `The new password must be ${PASSWORD_RULE}.`;
  return errorMessage(code, retry);
}

// The same, for the feed's settings and delete forms, which send a title and a description or the typed name.
export function feedDetailsErrorMessage(code: unknown, retry?: unknown): string | undefined {
  if (code === "invalid_body") return "The title, description or read id is too long or too short, or has characters that aren't allowed.";
  if (code === "invalid_request") return "Type the feed's name to confirm.";
  return noteErrorMessage(code, retry);
}

// The same, on a note page, where "auth" is a form refused for coming from outside (no feed or instance password involved).
export function noteErrorMessage(code: unknown, retry?: unknown): string | undefined {
  return code === "auth" ? "That didn't work. Reload the page and try again." : errorMessage(code, retry);
}

// The same, for an image upload, where "too_large" and "unsupported_type" are about the image, "auth" about a login that has
// lapsed, and "not_found" about a feed that cannot take images (no note yet, or no read link).
export function imageErrorMessage(code: unknown, retry?: unknown): string | undefined {
  const own: Record<string, string> = {
    too_large: "That image is too large.",
    unsupported_type: "Only PNG, JPEG, GIF and WebP images can be added.",
    auth: "You are not signed in for this feed. Reload the page and try again.",
    not_found: "Images can't be added to this feed yet.",
  };
  return own[String(code)] ?? errorMessage(code, retry);
}

// The same, for a note sent with its pictures: a refusal that names a picture (`attachment "a.png": …`) is worded as an image
// refusal, after the picture's name; any other goes to `message`.
export const withPictures =
  (message: (code: unknown, retry?: unknown) => string | undefined) =>
  (code: unknown, retry?: unknown, detail?: string): string | undefined => {
    const name = /^attachment "(.*)": /.exec(detail ?? "")?.[1];
    return name === undefined ? message(code, retry) : `${name}: ${imageErrorMessage(code, retry)}`;
  };
