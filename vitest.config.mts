import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", exclude: ["**/node_modules/**", "packages/**"] },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
