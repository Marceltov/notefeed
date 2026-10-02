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
    { name: "locked", testMatch: "locked.spec.ts", use: { baseURL: "http://localhost:3101" } },
  ],
  webServer: [server(3100, {}), server(3101, { NOTEFEED_PASSWORD: "e2e" })],
});
