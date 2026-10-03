// A header value holds bytes, not characters: fetch refuses a character above U+00FF, and a server (Node) reads the bytes as latin1.
// So text that may not be ASCII (a note's title, alt text, file name) travels as its UTF-8 bytes written as latin1 characters, and
// is read back the other way. curl sends raw UTF-8 bytes, which is the same thing on the wire.

export function encodeHeaderValue(text: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(text)) out += String.fromCharCode(byte);
  return out;
}

/** The text that `encodeHeaderValue` (or a raw UTF-8 header) carried; a value that is not valid UTF-8 bytes is returned as it is. */
export function decodeHeaderValue(value: string): string {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 255) return value; // already real characters
    bytes[i] = code;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}
