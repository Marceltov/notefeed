import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", exclude: ["**/node_modules/**", "packages/**", "e2e/**"] },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
