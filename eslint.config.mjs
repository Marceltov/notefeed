import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The frontend/backend boundary (see docs/adr/0003-backend-boundary.md).
const FRONTEND_IMPORTS = {
  patterns: [{ group: ["@/backend/*", "**/backend/*"], message: "The frontend imports the backend only through @/backend (backend/index.ts)." }],
};
const BACKEND_IMPORTS = {
  paths: ["next", "react", "react-dom"].map((name) => ({ name, message: "backend/ is framework-free." })),
  patterns: [
    { group: ["next/*", "react/*", "react-dom/*"], message: "backend/ is framework-free." },
    { group: ["@/app/*", "@/components/*", "@/proxy", "**/app/*", "**/components/*"], message: "backend/ never imports the frontend." },
    { group: ["@/backend", "@/backend/*"], message: "Inside backend/, use relative imports." },
  ],
};
const SHARED_IMPORTS = {
  patterns: [
    { group: ["node:*", "@/backend", "@/backend/*", "@/app/*", "@/components/*", "**/backend/*"], message: "shared/ runs in the browser too: no Node, backend or frontend imports." },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**", "components/**", "proxy.ts"],
    ignores: ["**/*.test.ts"],
    rules: { "no-restricted-imports": ["error", FRONTEND_IMPORTS] },
  },
  { files: ["backend/**"], rules: { "no-restricted-imports": ["error", BACKEND_IMPORTS] } },
  { files: ["shared/**"], rules: { "no-restricted-imports": ["error", SHARED_IMPORTS] } },
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
