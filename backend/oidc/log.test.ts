import { afterEach, beforeEach, expect, test, type MockInstance, vi } from "vitest";
import { logFailure } from "./log";

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());
const line = () => {
  expect(warn).toHaveBeenCalledTimes(1);
  return String(warn.mock.calls[0][0]);
};

test("one line: the reason, then each detail as key=value, strings quoted", () => {
  logFailure("token request rejected", { provider: "default", status: 400, error: "invalid_grant" });
  expect(line()).toBe('oidc: token request rejected provider="default" status=400 error="invalid_grant"');
});

test("without detail, just the reason", () => {
  logFailure("state mismatch or missing sign-in cookie");
  expect(line()).toBe("oidc: state mismatch or missing sign-in cookie");
});

test("a value can't break the line or fake another one", () => {
  logFailure("unknown provider", { provider: 'x"\n\roidc: forged \u2028\u0000\u001b[31m' });
  const l = line();
  expect(l).toBe('oidc: unknown provider provider="x\\"oidc: forged [31m"');
  expect(l).not.toMatch(/\p{Cc}|\p{Zl}|\p{Zp}/u);
});

test("each value is capped at 200 characters", () => {
  logFailure("unknown provider", { provider: "a".repeat(500) });
  expect(line()).toBe(`oidc: unknown provider provider="${"a".repeat(200)}"`);
});
