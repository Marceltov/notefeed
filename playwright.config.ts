// End-to-end tests against the production build (`npm run test:e2e` builds first).
// The password is read at startup, so open and locked behaviour each get their own server.
import { defineConfig } from "@playwright/test";

const server = (port: number, env: Record<string, string>) => ({
  command: `next start -p ${port}`,
  url: `http://localhost:${port}`,
  reuseExistingServer: !process.env.CI,
  env: { DATA_DIR: `test-results/data-${port}`, NOTEFEED_RATE_LIMIT: "0", ...env },
});

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "open", testMatch: "open.spec.ts", use: { baseURL: "http://localhost:3100" } },
    { name: "feedlock", testMatch: "feedlock.spec.ts", use: { baseURL: "http://localhost:3100" } },
    { name: "notes", testMatch: "notes.spec.ts", use: { baseURL: "http://localhost:3100" } },
    { name: "feeds", testMatch: "feeds.spec.ts", use: { baseURL: "http://localhost:3100" } },
    { name: "images", testMatch: "images.spec.ts", use: { baseURL: "http://localhost:3100" } },
    { name: "metrics", testMatch: "metrics.spec.ts", use: { baseURL: "http://localhost:3100" } },
    { name: "locked", testMatch: "locked.spec.ts", use: { baseURL: "http://localhost:3101" } },
    // The operator's imprint and privacy page: set on the locked server, unset on the open one.
    { name: "legal", testMatch: "legal.spec.ts" },
    // The same notes and pictures specs on the SQLite backend with its images in a folder (needs Node 22, like the app itself).
    { name: "sqlite", testMatch: ["notes.spec.ts", "images.spec.ts"], use: { baseURL: "http://localhost:3102" } },
    // The pictures spec with the images in an S3-compatible store (a stand-in started by e2e/s3-setup.ts). The built app's fetch is
    // Next's, not plain Node's, and only this run sends an upload through it.
    { name: "s3", testMatch: ["images.spec.ts", "operator.spec.ts"], use: { baseURL: "http://localhost:3103" } },
  ],
  globalSetup: "./e2e/s3-setup.ts",
  webServer: [
    server(3100, { NOTEFEED_METRICS: "1" }),
    server(3101, { NOTEFEED_PASSWORD: "e2e", NOTEFEED_IMPRINT_FILE: "e2e/fixtures/imprint.md", NOTEFEED_PRIVACY_FILE: "e2e/fixtures/privacy.md" }),
    server(3103, {
      NOTEFEED_STORAGE: "sqlite",
      NOTEFEED_DATABASE_URL: "file:test-results/e2e-3103.db",
      NOTEFEED_SECRET: "e2e-s3-secret-".padEnd(32, "x"),
      NOTEFEED_IMAGES: "s3",
      NOTEFEED_S3_ENDPOINT: "http://127.0.0.1:3199",
      NOTEFEED_S3_BUCKET: "e2e-images",
      NOTEFEED_S3_ACCESS_KEY: "e2e-access",
      NOTEFEED_S3_SECRET_KEY: "e2e-secret",
      NOTEFEED_OPERATOR_TOKEN: "e2e-operator-token-".padEnd(32, "x"),
    }),
    server(3102, { NOTEFEED_STORAGE: "sqlite", NOTEFEED_DATABASE_URL: "file:test-results/e2e-3102.db", NOTEFEED_IMAGES: "fs", NOTEFEED_IMAGES_DIR: "test-results/e2e-3102-images", NOTEFEED_SECRET: "e2e-sqlite-secret-".padEnd(32, "x") }),
  ],
});
