import { expect, test } from "vitest";
import { TOO_MANY_PICTURES, errorMessage, feedDetailsErrorMessage, feedErrorMessage, imageErrorMessage, noteErrorMessage, withPictures } from "./messages";

test("an inherited property name in the URL is an unknown code, not a crash", () => {
  for (const fn of [errorMessage, noteErrorMessage, feedErrorMessage, feedDetailsErrorMessage])
    for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty"]) expect(fn(code)).toBe("Something went wrong.");
});

test("known codes keep their wording", () => {
  expect(errorMessage("not_found")).toBe("Not found.");
  expect(errorMessage("rate_limited", "7")).toBe("Too many requests, try again in 7 seconds.");
});

test("a failed sign-in through the provider has its own wording", () => {
  expect(errorMessage("sign_in_failed")).toBe("Sign-in didn't work. Try again.");
});

test("an image upload to a feed that can't take one is worded neutrally", () => {
  expect(imageErrorMessage("not_found")).toBe("Images can't be added to this feed yet.");
  expect(noteErrorMessage("not_found")).not.toContain("images");
});

test("withPictures words a refusal that names a picture as an image refusal, with its name; others as before", () => {
  const message = withPictures(errorMessage);
  expect(message("unsupported_type", null, 'attachment "a.png": the body is not image/png')).toBe("a.png: Only PNG, JPEG, GIF and WebP images can be added.");
  expect(message("too_large", null, 'attachment "big.png": image exceeds the size limit')).toBe("big.png: That image is too large.");
  expect(message("too_large", null, "note exceeds 100 KB")).toBe("The note is over 100 KB.");
  expect(message("rate_limited", "5")).toBe("Too many requests, try again in 5 seconds.");
});

test("withPictures words an unnamed too-large refusal of a request with pictures by its two causes", () => {
  const message = withPictures(errorMessage, true);
  expect(message("too_large", null, "note exceeds 100 KB")).toBe("The note is too large: its text is over 100 KB, or a picture is too large.");
  expect(message("too_large", null, 'attachment "big.png": image exceeds the size limit')).toBe("big.png: That image is too large.");
  expect(message("rate_limited", "5")).toBe("Too many requests, try again in 5 seconds.");
  expect(withPictures(noteErrorMessage, true)("too_large")).toBe("The note is too large: its text is over 100 KB, or a picture is too large.");
  expect(withPictures(errorMessage, false)("too_large", null, "note exceeds 100 KB")).toBe("The note is over 100 KB.");
});

test("the message for more pictures than a note takes names the limit", () => {
  expect(TOO_MANY_PICTURES).toBe("A note can have at most 10 pictures.");
});

test("withPictures points at a title or an alt text refused for its characters", () => {
  const message = withPictures(errorMessage);
  const rule = "must be one line, without control or text-direction override characters";
  expect(message("invalid_body", null, `title ${rule}`)).toBe(`The title ${rule}.`);
  expect(message("invalid_body", null, `alt ${rule}`)).toBe(`The alt text ${rule}.`);
  expect(message("invalid_body", null, `attachment "a.png": alt ${rule}`)).toBe(`a.png: The alt text ${rule}.`);
  expect(message("invalid_body", null, "title must be at most 100 characters")).toBe("The note could not be read.");
});
