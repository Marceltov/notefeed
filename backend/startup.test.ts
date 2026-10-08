import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "./feedlock";
import { readIdOf, reservedFeedProblems, resetFeedsForTests } from "./feeds";
import { logsOf, logTo } from "./log";
import { createNote } from "./notes";
import { legalFileWarnings, logStartup, reservedFeedWarnings, reservedFolderWarnings, reservedHint, startupReport } from "./startup";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notefeed-startup-"));
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("NOTEFEED_SECRET", "test-secret-".padEnd(32, "x"));
  resetFeedsForTests();
});
afterEach(() => vi.unstubAllEnvs());
const stub = (vars: Record<string, string>) => Object.entries(vars).forEach(([k, v]) => vi.stubEnv(k, v));
const FULL = { ISSUER: "https://idp.example", CLIENT_ID: "id", CLIENT_SECRET: "the-secret", ALLOW: "ann@x.com" };
const provider = (name: string, vars: Partial<typeof FULL>) => stub(Object.fromEntries(Object.entries(vars).map(([k, v]) => [`NOTEFEED_OIDC_${name ? `${name}_` : ""}${k}`, v])));

test("the startup fields: features and caps, never a secret", () => {
  stub({ NOTEFEED_PASSWORD: "pw-value", NOTEFEED_TRUST_PROXY: "1", NOTEFEED_MAX_FEEDS: "10", NOTEFEED_MAX_NOTES_PER_FEED: "5", NOTEFEED_MAX_IMAGES_PER_FEED: "3", NOTEFEED_LOG_LEVEL: "debug", PUBLIC_URL: "" });
  provider("", FULL);
  const { fields } = startupReport();
  expect(fields).toEqual({ node: process.version, storage: "fs", dataDir: dir, passwordSet: true, oidcProviders: 1, publicUrlSet: false, trustProxy: true, maxFeeds: 10, maxNotesPerFeed: 5, maxImagesPerFeed: 3, logLevel: "debug", metrics: false });
  expect(JSON.stringify(startupReport())).not.toMatch(/pw-value|the-secret|ann@x\.com/);
});

test("an operator token that is too short is warned about, without its value", () => {
  const warned = () => startupReport().warnings.filter(([, m]) => m.includes("NOTEFEED_OPERATOR_TOKEN"));
  vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", "too-short");
  expect(JSON.stringify(warned())).not.toContain("too-short");
  expect(warned()).toEqual([["startup", "NOTEFEED_OPERATOR_TOKEN is shorter than 32 bytes; the operator endpoints stay off", {}]]);
  vi.stubEnv("NOTEFEED_OPERATOR_TOKEN", "x".repeat(32));
  expect(warned()).toEqual([]);
});

test("an imprint or privacy file that cannot be read is warned about by its setting's name, never its path", async () => {
  expect(await legalFileWarnings()).toEqual([]);
  await writeFile(join(dir, "imprint.md"), "# Imprint");
  vi.stubEnv("NOTEFEED_IMPRINT_FILE", join(dir, "imprint.md"));
  vi.stubEnv("NOTEFEED_PRIVACY_FILE", join(dir, "no-such-file.md"));
  const warnings = await legalFileWarnings();
  expect(warnings).toEqual([["startup", "a page's file cannot be read (missing, not a file, or larger than 256 KiB); the page is not shown", { setting: "NOTEFEED_PRIVACY_FILE" }]]);
  expect(JSON.stringify(warnings)).not.toContain(dir);
});

test("metrics on without a token are warned about, with no values; with a token, or off, there is no warning", () => {
  const warned = () => startupReport().warnings.filter(([, m]) => m.includes("NOTEFEED_METRICS_TOKEN"));
  expect(warned()).toEqual([]);
  stub({ NOTEFEED_METRICS: "1" });
  expect(warned()).toEqual([["startup", "metrics are on without NOTEFEED_METRICS_TOKEN: /metrics is open to anyone who can reach the app", {}]]);
  expect(startupReport().fields.metrics).toBe(true);
  stub({ NOTEFEED_METRICS_TOKEN: "s3cret" });
  expect(warned()).toEqual([]);
  expect(JSON.stringify(startupReport())).not.toContain("s3cret");
});

test("a provider configured partially is named with its missing variables; empty counts as unset", () => {
  stub({ PUBLIC_URL: "https://notes.example" });
  provider("WORK", { ISSUER: "https://idp.example", CLIENT_ID: "x" });
  provider("", { CLIENT_SECRET: "the-secret", ALLOW: "" });
  provider("MY_CLIENT", { CLIENT_ID: "x", ISSUER: "https://idp.example", ALLOW: "*" });
  provider("FULL", FULL);
  provider("EMPTY", { ISSUER: "", CLIENT_ID: "" }); // nothing set at all: no warning
  const P = "sign-in provider configured partially; it stays off";
  expect(startupReport().warnings).toEqual([
    ["startup", P, { provider: "default", missing: ["NOTEFEED_OIDC_ISSUER", "NOTEFEED_OIDC_CLIENT_ID", "NOTEFEED_OIDC_ALLOW"] }],
    ["startup", P, { provider: "my_client", missing: ["NOTEFEED_OIDC_MY_CLIENT_CLIENT_SECRET"] }],
    ["startup", P, { provider: "work", missing: ["NOTEFEED_OIDC_WORK_CLIENT_SECRET", "NOTEFEED_OIDC_WORK_ALLOW"] }],
  ]);
});

test("sign-in without PUBLIC_URL, and a log level that isn't one, are warned about", () => {
  stub({ PUBLIC_URL: "", NOTEFEED_LOG_LEVEL: "verbose" });
  provider("", FULL);
  expect(startupReport().warnings.map(([, m]) => m)).toEqual(["sign-in is on without PUBLIC_URL: the redirect URI comes from each request's Host header", "NOTEFEED_LOG_LEVEL is not a level; using info"]);
  expect(startupReport().fields.logLevel).toBe("info");
  stub({ NOTEFEED_LOG_LEVEL: " WARN " });
  expect(startupReport().warnings.map(([, m]) => m)).not.toContain("NOTEFEED_LOG_LEVEL is not a level; using info");
});

test("logStartup writes the info line, then the warnings", async () => {
  provider("WORK", { ISSUER: "https://idp.example", CLIENT_ID: "x" });
  stub({ NOTEFEED_RESERVED_FEEDS: "news", NOTEFEED_RESERVED_PASSWORD: "" });
  const logs = await logsOf(logStartup);
  expect(logs.map(({ level, component, msg }) => [level, component, msg])).toEqual([
    ["info", "startup", "notefeed started"],
    ["warn", "startup", "sign-in provider configured partially; it stays off"],
    ["warn", "feeds", "reserved feeds are listed but have no password; they are not created"],
  ]);
});

test("logStartup never throws, and its info line comes first even when the output fails", async () => {
  const restore = logTo(() => {
    throw new Error("log down");
  });
  await expect(logStartup()).resolves.toBeUndefined();
  restore();
});

test("a startup report that fails leaves an error line, and logStartup still resolves", async () => {
  await writeFile(join(dir, "file"), "");
  stub({ DATA_DIR: join(dir, "file"), NOTEFEED_RESERVED_FEEDS: "news", NOTEFEED_RESERVED_PASSWORD: "pw" }); // a file where the data directory should be
  resetFeedsForTests();
  const logs = await logsOf(logStartup);
  expect(logs.at(-1)).toMatchObject({ level: "error", component: "startup", msg: "startup report failed", err: { code: "ENOTDIR" } });
});

test("a reserved name that was already an open feed, or has another read id, is warned about by name only", async () => {
  await createNote("news", "# old open feed"); // made before `news` was reserved: open, random read id
  await createNote("jobs", "# x");
  await mkdir(join(dir, "jobs"), { recursive: true });
  await writeFile(join(dir, "jobs", ".password"), await hashPassword("other")); // protected, but its read id isn't "jobs"
  resetFeedsForTests();
  stub({ NOTEFEED_RESERVED_FEEDS: "news,jobs,events,bad name", NOTEFEED_RESERVED_PASSWORD: "the-reserved-pw" });
  expect(await reservedFeedProblems()).toEqual([
    { feed: "news", problem: "unprotected" },
    { feed: "jobs", problem: "read_id" },
  ]);
  expect(await readIdOf("events")).toBe("events"); // made by load(), as it should be: no warning
  const hint = "delete its folder in DATA_DIR and restart so it is recreated protected, with its read id equal to its name";
  expect(await reservedFeedWarnings()).toEqual([
    ["feeds", "reserved feed exists but is not protected", { feed: "news", hint }],
    ["feeds", "reserved feed exists with another read id than its name", { feed: "jobs", hint }],
  ]);
  const logs = await logsOf(logStartup);
  expect(logs.filter((l) => l.component === "feeds")).toEqual([
    { level: "warn", component: "feeds", msg: "reserved feed exists but is not protected", feed: "news", hint },
    { level: "warn", component: "feeds", msg: "reserved feed exists with another read id than its name", feed: "jobs", hint },
  ]);
  expect(JSON.stringify(logs)).not.toMatch(/the-reserved-pw|scrypt|\$/);
});

test("without NOTEFEED_RESERVED_PASSWORD there is nothing to check", async () => {
  await createNote("news", "# x");
  stub({ NOTEFEED_RESERVED_FEEDS: "news", NOTEFEED_RESERVED_PASSWORD: "" });
  expect(await reservedFeedProblems()).toEqual([]);
});

test("a folder named like one of notefeed's own routes is warned about, with its name; ordinary names are not", async () => {
  expect(await reservedFolderWarnings()).toEqual([]);
  for (const n of ["metrics", "health", "ordinary"]) await mkdir(join(dir, n));
  const hint = "rename its folder in DATA_DIR to a name that is not reserved, and restart";
  expect(await reservedFolderWarnings()).toEqual([["feeds", "a feed folder is named like one of notefeed's routes; it cannot be opened by name", { feeds: ["health", "metrics"], hint }]]);
  const logs = await logsOf(logStartup);
  expect(logs.filter((l) => l.component === "feeds")).toEqual([{ level: "warn", component: "feeds", msg: "a feed folder is named like one of notefeed's routes; it cannot be opened by name", feeds: ["health", "metrics"], hint }]);
});

test("a wrong storage setting keeps logStartup from succeeding, naming the variable and never its value", async () => {
  stub({ NOTEFEED_STORAGE: "postgres", NOTEFEED_DATABASE_URL: "" });
  await expect(logStartup()).rejects.toThrow(/NOTEFEED_DATABASE_URL/);
  stub({ NOTEFEED_STORAGE: "sqlite", NOTEFEED_SECRET: "" });
  await expect(logStartup()).rejects.toThrow(/NOTEFEED_SECRET/);
  stub({ NOTEFEED_STORAGE: "mongo" });
  await expect(logStartup()).rejects.toThrow(/NOTEFEED_STORAGE/);
});

test("the hint for a reserved feed that already exists fits the storage: a folder on fs, the feed itself on a database", () => {
  expect(reservedHint("fs")).toMatch(/folder in DATA_DIR/);
  for (const kind of ["sqlite", "postgres"] as const) {
    expect(reservedHint(kind)).toMatch(/delete the feed/);
    expect(reservedHint(kind)).not.toMatch(/folder|DATA_DIR/);
  }
});
