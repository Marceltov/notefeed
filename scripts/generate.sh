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
#    the spec where postNote's body is JSON only: the one the Python client sends.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
node -e '
  const spec = require("./openapi.json");
  const body = spec.paths["/api/v1/feeds/{feed}/notes"].post.requestBody;
  body.content = { "application/json": body.content["application/json"] };
  require("fs").writeFileSync(process.argv[1], JSON.stringify(spec));
' "$tmp/openapi.json"
uvx openapi-python-client@0.29.1 generate --path "$tmp/openapi.json" --meta none \
  --output-path packages/python/src/notefeed/_generated --overwrite
