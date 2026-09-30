import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("version", () => {
  expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
});

test.skipIf(!existsSync(new URL("../../python/pyproject.toml", import.meta.url)))("matchesPythonPackage", () => {
  const toml = readFileSync(new URL("../../python/pyproject.toml", import.meta.url), "utf8");
  expect(toml.match(/^version = "(.*)"$/m)?.[1]).toBe(pkg.version);
});
