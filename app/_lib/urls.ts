// Where to go after login: a same-origin path, else "/". A second "/" or any "\" would make it
// protocol-relative (browsers read "\" as "/"), and browsers drop tabs and newlines, so "/\t/x" is "//x".
export const safeNext = (v: unknown): string =>
  typeof v === "string" && /^\/(?![/\\])[^\\\x00-\x1f\x7f]*$/.test(v) ? v : "/";
