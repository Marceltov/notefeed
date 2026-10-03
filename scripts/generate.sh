#!/bin/sh
# Regenerates everything derived from the API's route table (backend/http/api.ts). Commit the result;
# CI runs this and fails on any difference.
set -e
cd "$(dirname "$0")/.."

# 1. openapi.json, from the route table (vitest resolves backend/'s TypeScript imports).
UPDATE_OPENAPI=1 npx vitest run backend/http/openapi.test.ts --silent >/dev/null

# 2. The JS clients (npm package and the web UI's browser code). Needs Node >= 22.18.
npx openapi-ts

# 3. The Python client. Needs uv. openapi-python-client 0.29.1 generates broken code for a request
#    body with several content types (an optional union, `Unset` not imported), so it gets a copy of
#    the spec where every body offered in several content types is JSON only (or, for a binary body, octet-stream only, else the first type: the client sets the real Content-Type per call): the one the Python client sends. ruff (which the
#    generator formats its output with) is pinned too, so a ruff release can't change the output.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
node -e '
  const spec = require("./openapi.json");
  for (const item of Object.values(spec.paths))
    for (const o of Object.values(item)) {
      const c = o.requestBody?.content;
      if (c && Object.keys(c).length > 1) {
        if (c["application/json"]) o.requestBody.content = { "application/json": c["application/json"] };
        else {
          // A file body in several media types (any file the server accepts): the generator only reads octet-stream, so offer that; the client sets the real Content-Type per call.
          const first = c["application/octet-stream"] ?? Object.values(c)[0];
          o.requestBody.content = { "application/octet-stream": first };
        }
      }
    }
  require("fs").writeFileSync(process.argv[1], JSON.stringify(spec));
' "$tmp/openapi.json"
uvx --with ruff==0.16.9 openapi-python-client@0.29.1 generate --path "$tmp/openapi.json" --meta none \
  --output-path packages/python/src/notefeed/_generated --overwrite
