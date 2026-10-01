// Generates the JS API clients from openapi.json (itself generated from backend/http/api.ts).
// Run through `npm run generate`; the output is committed.
import { defineConfig } from "@hey-api/openapi-ts";

const plugins = ["@hey-api/typescript", "@hey-api/sdk", "@hey-api/client-fetch"] as const;

export default defineConfig([
  // The npm package's core (packages/js), wrapped by its hand-written Client. The package compiles
  // with moduleResolution nodenext, which needs explicit .js extensions.
  { input: "openapi.json", output: { path: "packages/js/src/generated", module: { extension: ".js" } }, plugins: [...plugins] },
  // The web UI's browser code (the compose box).
  { input: "openapi.json", output: "app/_lib/api", plugins: [...plugins] },
]);
