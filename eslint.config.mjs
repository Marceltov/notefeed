import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    // MkDocs output (docs site), not app code.
    "site/**",
    // Client packages have their own tooling.
    "packages/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
