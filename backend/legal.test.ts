import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MAX_LEGAL_BYTES, hasLegalPage, readLegalPage, unreadableLegalSettings } from "./legal";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-legal-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

test("without the settings there is neither page", async () => {
  vi.stubEnv("NOTEFEED_IMPRINT_FILE", "");
  vi.stubEnv("NOTEFEED_PRIVACY_FILE", "");
  for (const page of ["imprint", "privacy"] as const) {
    expect(await hasLegalPage(page)).toBe(false);
    expect(await readLegalPage(page)).toBeNull();
  }
  expect(await unreadableLegalSettings()).toEqual([]);
});

test("each setting names its own page's file, read as it is", async () => {
  await writeFile(join(dir, "i.md"), "# Imprint\n\nJane Doe, Musterstraße 1");
  await writeFile(join(dir, "p.md"), "# Privacy\n\n<b>not html</b> ünïcödé");
  vi.stubEnv("NOTEFEED_IMPRINT_FILE", join(dir, "i.md"));
  vi.stubEnv("NOTEFEED_PRIVACY_FILE", join(dir, "p.md"));
  expect(await hasLegalPage("imprint")).toBe(true);
  expect(await readLegalPage("imprint")).toBe("# Imprint\n\nJane Doe, Musterstraße 1");
  expect(await readLegalPage("privacy")).toBe("# Privacy\n\n<b>not html</b> ünïcödé");
  expect(await unreadableLegalSettings()).toEqual([]);
});

test("only one of the two may be set", async () => {
  await writeFile(join(dir, "i.md"), "# Imprint");
  vi.stubEnv("NOTEFEED_IMPRINT_FILE", join(dir, "i.md"));
  vi.stubEnv("NOTEFEED_PRIVACY_FILE", "");
  expect(await hasLegalPage("imprint")).toBe(true);
  expect(await hasLegalPage("privacy")).toBe(false);
});

test("an edited file shows at once", async () => {
  await writeFile(join(dir, "p.md"), "one");
  vi.stubEnv("NOTEFEED_PRIVACY_FILE", join(dir, "p.md"));
  expect(await readLegalPage("privacy")).toBe("one");
  await writeFile(join(dir, "p.md"), "two");
  expect(await readLegalPage("privacy")).toBe("two");
});

test("a setting that names no file, a folder or a file that is too large gives no page, and is named for the log", async () => {
  await mkdir(join(dir, "folder"));
  await writeFile(join(dir, "big.md"), "x".repeat(MAX_LEGAL_BYTES + 1));
  await writeFile(join(dir, "fits.md"), "x".repeat(MAX_LEGAL_BYTES));
  for (const bad of [join(dir, "missing.md"), join(dir, "folder"), join(dir, "big.md")]) {
    vi.stubEnv("NOTEFEED_PRIVACY_FILE", bad);
    expect(await hasLegalPage("privacy")).toBe(false);
    expect(await readLegalPage("privacy")).toBeNull();
    expect(await unreadableLegalSettings()).toEqual(["NOTEFEED_PRIVACY_FILE"]);
  }
  vi.stubEnv("NOTEFEED_PRIVACY_FILE", join(dir, "fits.md"));
  expect(await hasLegalPage("privacy")).toBe(true);
});

test("a link to a file is followed: the operator chose the path", async () => {
  await writeFile(join(dir, "real.md"), "linked");
  await symlink(join(dir, "real.md"), join(dir, "link.md"));
  vi.stubEnv("NOTEFEED_IMPRINT_FILE", join(dir, "link.md"));
  expect(await readLegalPage("imprint")).toBe("linked");
});
