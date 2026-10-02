import { expect, test } from "vitest";
import { errorMessage, feedDetailsErrorMessage, feedErrorMessage, noteErrorMessage } from "./messages";

test("an inherited property name in the URL is an unknown code, not a crash", () => {
  for (const fn of [errorMessage, noteErrorMessage, feedErrorMessage, feedDetailsErrorMessage])
    for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty"]) expect(fn(code)).toBe("Something went wrong.");
});

test("known codes keep their wording", () => {
  expect(errorMessage("not_found")).toBe("Not found.");
  expect(errorMessage("rate_limited", "7")).toBe("Too many requests, try again in 7 seconds.");
});
