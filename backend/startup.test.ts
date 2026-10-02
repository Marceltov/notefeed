import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "./feedlock";
import { readIdOf, reservedFeedProblems, resetFeedsForTests } from "./feeds";
import { logsOf, logTo } from "./log";
import { createNote } from "./notes";
import { logStartup, reservedFeedWarnings, startupReport } from "./startup";

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
  expect(fields).toEqual({ node: process.version, dataDir: dir, passwordSet: true, oidcProviders: 1, publicUrlSet: false, trustProxy: true, maxFeeds: 10, maxNotesPerFeed: 5, maxImagesPerFeed: 3, logLevel: "debug" });
  expect(JSON.stringify(startupReport())).not.toMatch(/pw-value|the-secret|ann@x\.com/);
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
