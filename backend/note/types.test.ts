import { describe, expect, test } from "vitest";
import { ACCEPTED_TYPES, mediaTypeOf, parseMediaType, typeForExt } from "./types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]);

describe("parseMediaType", () => {
  test("text/markdown is markdown, with or without charset=utf-8, in any case", () => {
    for (const h of ["text/markdown", "TEXT/Markdown", "text/markdown; charset=utf-8", "text/markdown;charset=UTF-8", 'text/markdown; charset="utf-8"']) {
      expect(parseMediaType(h), h).toMatchObject({ mediaType: "text/markdown", ext: "md", type: { name: "markdown" } });
    }
  });
  test("each image type maps to its extension", () => {
    expect(parseMediaType("image/png")).toMatchObject({ mediaType: "image/png", ext: "png", type: { name: "image" } });
    expect(parseMediaType("image/jpeg")?.ext).toBe("jpg");
    expect(parseMediaType("image/gif")?.ext).toBe("gif");
    expect(parseMediaType("image/webp")?.ext).toBe("webp");
  });
  test.each([null, "", "text/plain", "application/x-www-form-urlencoded", "application/octet-stream", "application/json", "image/svg+xml", "image/jpg", "text/markdown; charset=iso-8859-1", "text/markdown; charset=utf-8; q=1", "image/png; q=1", "multipart/form-data; boundary=x"])(
    "%j is not accepted",
    (h) => expect(parseMediaType(h)).toBeNull(),
  );
});

describe("verify: the body is what was declared", () => {
  const verify = (mediaType: string, bytes: Uint8Array) => {
    const p = parseMediaType(mediaType)!;
    return p.type.verify(bytes, p.ext);
  };
  test("an image has the signature of its declared format", () => {
    expect(verify("image/png", PNG)).toBe(true);
    expect(verify("image/jpeg", PNG)).toBe(false);
    expect(verify("image/png", JPG)).toBe(false);
    expect(verify("image/png", new TextEncoder().encode("<svg/>"))).toBe(false);
    expect(verify("image/png", new Uint8Array())).toBe(false);
  });
  test("markdown is valid UTF-8; emptiness is posting's rule", () => {
    expect(verify("text/markdown", new TextEncoder().encode("# Café"))).toBe(true);
    expect(verify("text/markdown", new Uint8Array([0xff, 0xfe, 0x41]))).toBe(false);
    expect(verify("text/markdown", new Uint8Array())).toBe(true);
  });
});

test("mediaTypeOf maps an extension to its media type, an unknown one to octet-stream", () => {
  expect(mediaTypeOf("md")).toBe("text/markdown");
  expect(mediaTypeOf("jpg")).toBe("image/jpeg");
  expect(mediaTypeOf("webp")).toBe("image/webp");
  expect(mediaTypeOf("pdf")).toBe("application/octet-stream");
});

test("ACCEPTED_TYPES names every media type, for the error message", () => {
  for (const t of ["text/markdown", "image/png", "image/jpeg", "image/gif", "image/webp"]) expect(ACCEPTED_TYPES).toContain(t);
});

test("the registry still finds a type by extension", () => {
  expect(typeForExt("png")?.name).toBe("image");
});
