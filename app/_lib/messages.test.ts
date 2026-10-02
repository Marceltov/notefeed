import { expect, test } from "vitest";
import { errorMessage, feedDetailsErrorMessage, feedErrorMessage, imageErrorMessage, noteErrorMessage } from "./messages";

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
