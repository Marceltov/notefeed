import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openApiDocument } from "./api";

// The committed description the clients and the docs site are generated from. `npm run generate`
// rewrites it (UPDATE_OPENAPI=1); CI fails when it's stale.
const FILE = join(import.meta.dirname, "../../openapi.json");
const generated = () => JSON.stringify(openApiDocument("https://notefeed.me"), null, 2) + "\n";

test("openapi.json is up to date with the route table", async () => {
  if (process.env.UPDATE_OPENAPI === "1") await writeFile(FILE, generated());
  expect(await readFile(FILE, "utf8").catch(() => "missing")).toBe(generated());
});

test("every $ref points at a component", () => {
  const doc = openApiDocument("https://notefeed.me");
  const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]);
  expect(refs.length).toBeGreaterThan(0);
  for (const r of refs) expect((doc.components as { schemas: object }).schemas).toHaveProperty(r);
});
