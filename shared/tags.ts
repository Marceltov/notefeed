// A comma-separated list of tags as typed in a form: up to 10, each 1 to 32 letters, digits, `-`, `_`, `.` or `:`.
// An HTML `pattern` (which the browser anchors itself); the backend (backend/tags.ts) is the real check and also folds case.
export const TAGS_PATTERN = "\\s*([A-Za-z0-9_.:\\-]{1,32}\\s*(,\\s*[A-Za-z0-9_.:\\-]{1,32}\\s*){0,9})?";
export const TAGS_HINT = "Up to 10 tags, separated by commas, each 1 to 32 letters, digits, - _ . or :";
