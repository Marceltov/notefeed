// The startup line and what is wrong with the configuration, logged once when the server starts
// (instrumentation.ts). Names of variables only, never their values.
import { config, LOG_LEVELS, type StorageKind } from "./config";
import { reservedFeedProblems, RESERVED_FEEDS } from "./feeds";
import { unreadableLegalSettings } from "./legal";
import { logger } from "./log";
import { missingVars, providers } from "./oidc/config";
import { storage } from "./storage";

type Fields = Record<string, unknown>;

// One of a provider's four variables: group 1 is its NAME, absent for the unprefixed set.
const PROVIDER_VAR = /^NOTEFEED_OIDC_(?:([A-Z0-9]+(?:_[A-Z0-9]+)*?)_)?(?:ISSUER|CLIENT_ID|CLIENT_SECRET|ALLOW)$/;

// A warning: component, msg, fields.
type Warning = [string, string, Fields];

// What to do about a reserved feed that already exists unprotected or under another read id.
export const reservedHint = (kind: StorageKind): string =>
  kind === "fs"
    ? "delete its folder in DATA_DIR and restart so it is recreated protected, with its read id equal to its name"
    : "delete the feed and restart so it is recreated protected, with its read id equal to its name";

export function startupReport(env: NodeJS.ProcessEnv = process.env): { fields: Fields; warnings: Warning[] } {
  const warnings: Warning[] = [];
  // A provider some but not all of whose variables are set (empty counts as unset) stays off: say which are missing.
  const names = new Set(Object.entries(env).flatMap(([k, v]) => (v ? (PROVIDER_VAR.exec(k)?.slice(1, 2) ?? []) : []).map((n) => n ?? "")));
  for (const name of [...names].filter((n) => n !== "DEFAULT").sort()) {
    const missing = missingVars(name);
    if (missing.length > 0 && missing.length < 4) warnings.push(["startup", "sign-in provider configured partially; it stays off", { provider: name ? name.toLowerCase() : "default", missing }]);
  }
  const oidcProviders = providers().length;
  if (oidcProviders && !config.publicUrl()) warnings.push(["startup", "sign-in is on without PUBLIC_URL: the redirect URI comes from each request's Host header", {}]);
  const level = (env.NOTEFEED_LOG_LEVEL ?? "").trim().toLowerCase();
  if (level && level !== config.logLevel()) warnings.push(["startup", "NOTEFEED_LOG_LEVEL is not a level; using info", { accepted: [...LOG_LEVELS] }]);
  if (config.reservedFeeds().length && !config.reservedPassword()) warnings.push(["feeds", "reserved feeds are listed but have no password; they are not created", {}]);
  if (config.metrics() && !config.metricsToken()) warnings.push(["startup", "metrics are on without NOTEFEED_METRICS_TOKEN: /metrics is open to anyone who can reach the app", {}]);
  if (config.operatorTokenTooShort()) warnings.push(["startup", "NOTEFEED_OPERATOR_TOKEN is shorter than 32 bytes; the operator endpoints stay off", {}]);
  const fields = {
    node: process.version,
    storage: config.storage(),
    dataDir: config.dataDir(),
    passwordSet: config.password() !== "",
    oidcProviders,
    publicUrlSet: config.publicUrl() !== "",
    trustProxy: config.trustProxy(),
    maxFeeds: config.maxFeeds(),
    maxNotesPerFeed: config.maxNotesPerFeed(),
    maxImagesPerFeed: config.maxImagesPerFeed(),
    logLevel: config.logLevel(),
    metrics: config.metrics(),
  };
  return { fields, warnings };
}

// A reserved name that was already an ordinary feed when it was listed: load() leaves such a feed as it is.
export async function reservedFeedWarnings(): Promise<Warning[]> {
  return (await reservedFeedProblems()).map(({ feed, problem }) => [
    "feeds",
    problem === "unprotected" ? "reserved feed exists but is not protected" : "reserved feed exists with another read id than its name",
    { feed, hint: reservedHint(config.storage()) },
  ]);
}

// A feed folder that predates a route name notefeed reserves (like `metrics`, which became the scrape route) can no longer be opened
// by name. The names are notefeed's own fixed ones, not a user's feed names, so they may be logged.
export async function reservedFolderWarnings(): Promise<Warning[]> {
  const feeds = (await storage().listFeedNames()).filter((n) => RESERVED_FEEDS.has(n)).sort();
  return feeds.length
    ? [["feeds", "a feed folder is named like one of notefeed's routes; it cannot be opened by name", { feeds, hint: "rename its folder in DATA_DIR to a name that is not reserved, and restart" }]]
    : [];
}

// Throws only for a wrong storage setting; any other failure here must not keep the server from starting.
// An imprint or privacy page that was asked for and cannot be shown: the visitor would only see that the link is missing.
export async function legalFileWarnings(): Promise<Warning[]> {
  return (await unreadableLegalSettings()).map((setting) => ["startup", "a page's file cannot be read (missing, not a file, or larger than 256 KiB); the page is not shown", { setting }]);
}

export async function logStartup(): Promise<void> {
  config.validateStorage(); // a wrong storage setting keeps the server from starting; the one failure not caught below
  const warn = (warnings: Warning[]) => warnings.forEach(([component, msg, f]) => logger(component).warn(f, msg));
  try {
    const { fields, warnings } = startupReport();
    logger("startup").info(fields, "notefeed started");
    warn(warnings);
    warn(await legalFileWarnings());
    warn(await reservedFolderWarnings());
    warn(await reservedFeedWarnings()); // loads the feed index, which creates missing reserved feeds
  } catch (e) {
    try {
      logger("startup").error({ err: e }, "startup report failed");
    } catch {}
  }
}
