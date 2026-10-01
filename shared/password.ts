// A feed password: 1 to 256 printable ASCII characters (0x20–0x7E) with no space at either end, so the
// same password arrives unchanged in an HTTP header, a form and JSON. Written as an HTML `pattern`
// (which the browser anchors itself), so the forms and the backend check the same rule.
export const PASSWORD_PATTERN = "[!-~]([ -~]{0,254}[!-~])?";
export const PASSWORD_RULE = "1 to 256 printable ASCII characters, with no space at the start or end";
