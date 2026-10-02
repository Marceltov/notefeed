import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests that check log lines capture them with logTo() or createLogger(); the rest print nothing.
  test: { environment: "node", exclude: ["**/node_modules/**", "packages/**", "e2e/**"], env: { NOTEFEED_LOG_LEVEL: "silent" } },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
